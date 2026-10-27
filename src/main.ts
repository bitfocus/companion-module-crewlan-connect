import { InstanceBase, InstanceStatus, type InstanceTypes, type SomeCompanionConfigField } from '@companion-module/base'
import { CrewLanApiClient, CrewLanApiError, isAbortError, type ControlsPatch, type RequestOptions } from './api.js'
import {
	CrewLanV2Client,
	isRequestNotOfferedLocally,
	offlineStatusId,
	probeIntegrationApi,
	wireRequests,
	type IntegrationControlsBody,
	type IntegrationState,
} from './api-v2.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import {
	GetConfigFields,
	migrateLegacyEntityToken,
	resolveEntityToken,
	resolvePollIntervalMs,
	type ModuleConfig,
	type ModuleSecrets,
} from './config.js'
import { isOffered, UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import {
	isPublicAlertTriggeredEventData,
	isPublicEntityControlsDto,
	isPublicEntityStatusDto,
	isPublicMacroDto,
	isPublicMacroRemovedEventData,
} from './guards.js'
import { UpdatePresets } from './presets.js'
import { getCompanionStatusLabel } from './button-style.js'
import type {
	CrewLanChoice,
	CrewLanState,
	IntegrationEventEnvelope,
	IntercomGroupState,
	PublicEntityControlsDto,
	PublicEntityStatusDto,
	PublicEventEnvelope,
	PublicMacroDto,
	PublicStatusDto,
} from './types.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'

/** Reconciliation interval while the live event stream is healthy. */
export const streamHealthyPollIntervalMs = 30_000
/** How often a v2 connection reads its controls; see `scheduleControlsRead`. */
export const integrationControlsReadIntervalMs = 1000
/** CrewLAN writes a heartbeat comment every 15 s; three missed heartbeats mean the stream is dead. */
export const eventStreamIdleTimeoutMs = 45_000
export const reconnectBackoffBaseMs = 1000
export const reconnectBackoffMaxMs = 30_000
/**
 * How long an event stream has to stay open before its loss counts as the failure of a healthy
 * stream rather than as another flap. It is the backoff cap: a host that cannot hold the stream for
 * longer than the longest retry delay is not recovering, it is flapping, and its backoff has to keep
 * growing instead of restarting from one second.
 */
export const streamStableAfterMs = reconnectBackoffMaxMs
/** Retry cadence for failures only CrewLAN itself can clear (a rejected token, a 400/404 answer). */
export const nonRecoverableRetryDelayMs = 60_000
/** How long `last_alert` keeps reporting an alert that was never dismissed. */
export const alertRetentionMs = 5 * 60 * 1000
/**
 * Talk release retry budget.
 *
 * The worst case is three attempts of 2000 ms plus 1250 ms of pauses, which outlasts the 5 s after
 * which Companion stops waiting for an action. That is accepted deliberately: a lost release
 * leaves a live microphone behind a button that already looks idle.
 */
export const talkReleaseAttempts = 3
export const talkReleaseTimeoutMs = 2000
const talkReleaseRetryDelaysMs = [250, 1000]

export const authenticationFailedConnectionMessage = 'Could not establish a connection because authentication failed.'

type StateGroup = 'connection' | 'status' | 'controls' | 'macros' | 'intercom' | 'indicators'

/** What an action that needs `/api/v2` logs over the Public API v1, where it changes nothing. */
export function needsIntegrationApiMessage(actionName: string): string {
	return `${actionName} needs a CrewLAN Workspace serving /api/v2; this one speaks the Public API v1 and has only Global Talk and Output.`
}

/** The sentence CrewLAN gives a write while the connection's Entity is not present at a Client. */
export const ownerAbsentMessage = 'CrewLAN rejects actions while the entity is not present.'

/** Whether a refusal says the connection's Entity is not present at a Client — not a revoked token. */
export function isOwnerAbsentError(error: unknown): boolean {
	return error instanceof CrewLanApiError && error.statusCode === 401 && error.code === 'connection_owner_absent'
}

/**
 * Which slice of the state each feedback reads. Typed as an exhaustive record so a feedback added
 * to FeedbacksSchema without an entry here fails to compile instead of silently never being
 * re-checked. Only the feedbacks of the groups that actually changed are re-checked.
 */
const feedbackStateGroups: Record<keyof FeedbacksSchema, StateGroup | readonly StateGroup[]> = {
	connection_ok: 'connection',
	status_is: 'status',
	status_style: 'status',
	listen_enabled: 'controls',
	listen_available: 'controls',
	listen_muted: 'controls',
	talk_enabled: 'controls',
	talk_available: 'controls',
	talk_push_active: 'controls',
	talk_latch_active: 'controls',
	talk_active: 'controls',
	talk_live: 'controls',
	macro_running: 'macros',
	macro_style: 'macros',
	// The readiness feedbacks read the connection (connected, owner present); the state ones do not.
	connection_ready: 'connection',
	input_muted: 'intercom',
	group_talk_available: ['connection', 'intercom'],
	group_talk_active: 'intercom',
	group_muted: 'intercom',
	call_ringing: 'intercom',
	call_calling: 'intercom',
	call_active: 'intercom',
	answer_available: ['connection', 'intercom'],
	call_talk_available: ['connection', 'intercom'],
	call_talk_active: 'intercom',
	group_member: ['connection', 'intercom'],
	indicator_status_is: 'indicators',
	indicator_ready: ['connection', 'indicators'],
}

export function feedbackIdsForGroups(groups: ReadonlySet<StateGroup>): (keyof FeedbacksSchema)[] {
	return (Object.keys(feedbackStateGroups) as (keyof FeedbacksSchema)[]).filter((id) => {
		const read = feedbackStateGroups[id]

		return typeof read === 'string' ? groups.has(read) : read.some((group) => groups.has(group))
	})
}

function createInitialState(): CrewLanState {
	return {
		connected: false,
		streamConnected: false,
		entityId: null,
		workspace: null,
		entity: null,
		statuses: [],
		macros: [],
		macrosSupported: false,
		status: null,
		controls: null,
		lastAlert: '',
		lastError: '',
		api: null,
		ownerPresent: true,
		intercom: null,
		targetKind: null,
		requests: null,
		indicators: [],
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}

	return 'Unknown CrewLAN error.'
}

export function statusForError(error: unknown): InstanceStatus {
	if (error instanceof CrewLanApiError) {
		if (error.statusCode === 401 || error.statusCode === 403) {
			return InstanceStatus.AuthenticationFailure
		}

		if (error.statusCode === 400 || error.statusCode === 404) {
			return InstanceStatus.BadConfig
		}

		if (error.statusCode !== null) {
			return InstanceStatus.ConnectionFailure
		}

		if (error.kind === 'config') {
			return InstanceStatus.BadConfig
		}

		if (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'invalid-response') {
			return InstanceStatus.ConnectionFailure
		}

		const message = error.message.toLowerCase()

		if (message.includes('address') || message.includes('url')) {
			return InstanceStatus.BadConfig
		}

		if (message.includes('token') || message.includes('capability')) {
			return InstanceStatus.AuthenticationFailure
		}
	}

	if (error instanceof Error) {
		return InstanceStatus.ConnectionFailure
	}

	return InstanceStatus.UnknownError
}

/** Status text shown in the connection list; authentication details are kept out of it. */
export function describeCompanionErrorForDisplay(error: unknown): string {
	if (statusForError(error) === InstanceStatus.AuthenticationFailure) {
		// A 403 with CrewLAN's own sentence names what an administrator switched off and where it is
		// switched on again — v1's `compatibility_mode_off` — which is no secret of the token.
		if (error instanceof CrewLanApiError && error.statusCode === 403 && error.code !== null) {
			return `${authenticationFailedConnectionMessage} ${error.message}`
		}

		return authenticationFailedConnectionMessage
	}

	return describeError(error)
}

/**
 * Whether an error raised by an action means the connection itself is gone. HTTP errors are
 * deliberately excluded: CrewLAN answers 401 to writes while the entity is not present, and a
 * 404/409/429/5xx on one action says nothing about the connection.
 */
export function isConnectionLevelError(error: unknown): boolean {
	if (error instanceof CrewLanApiError) {
		return error.kind === 'network' || error.kind === 'timeout'
	}

	return error instanceof Error && !isAbortError(error)
}

/**
 * Whether the connection failed on its own configuration — no token, or an address that is not a
 * URL — rather than on anything CrewLAN said. Such a failure happens before the first request and
 * cannot change until the operator edits the connection, so it is reported as a bad configuration
 * and then left alone.
 */
export function isConfigurationError(error: unknown): boolean {
	return error instanceof CrewLanApiError && error.kind === 'config'
}

function isNonRecoverableStatus(status: InstanceStatus): boolean {
	return status === InstanceStatus.AuthenticationFailure || status === InstanceStatus.BadConfig
}

/** Exponential backoff with ±20 % jitter, or a long fixed delay for errors a retry cannot fix. */
export function computeReconnectDelayMs(attempt: number, status: InstanceStatus, random = Math.random()): number {
	if (isNonRecoverableStatus(status)) {
		return nonRecoverableRetryDelayMs
	}

	const base = Math.min(reconnectBackoffMaxMs, reconnectBackoffBaseMs * 2 ** Math.max(0, attempt))
	const jitter = base * 0.2 * (random * 2 - 1)

	return Math.max(reconnectBackoffBaseMs, Math.round(base + jitter))
}

/**
 * Describe an alert for the `last_alert` variable. The Public API event carries only the scope and
 * the targeted entity ids, never the alert text, so the description says when and how it arrived.
 */
export function describeAlert(occurredAt: string, scope: 'workspace' | 'entities'): string {
	const when = occurredAt.length > 0 ? occurredAt : 'unknown time'

	return scope === 'workspace' ? `Workspace alert at ${when}` : `Alert for this entity at ${when}`
}

function parseTimestamp(value: string | null | undefined): number | null {
	if (typeof value !== 'string') {
		return null
	}

	const parsed = Date.parse(value)

	return Number.isNaN(parsed) ? null : parsed
}

/**
 * Decide whether a status/controls payload may replace the one currently held.
 *
 * Server timestamps win when both sides carry one. Without usable timestamps the payload is only
 * trusted if it was requested after the last local write, so a poll that was already in flight
 * when the operator pressed a button cannot roll that button's result back.
 */
export function pickFresher<T extends { updatedAt?: string | null }>(
	current: T | null,
	incoming: T,
	incomingRequestedAt: number,
	lastLocalWriteAt: number,
): T {
	if (current === null) {
		return incoming
	}

	const incomingAt = parseTimestamp(incoming.updatedAt)
	const currentAt = parseTimestamp(current.updatedAt)

	if (incomingAt !== null && currentAt !== null && incomingAt !== currentAt) {
		return incomingAt > currentAt ? incoming : current
	}

	return incomingRequestedAt >= lastLocalWriteAt ? incoming : current
}

/**
 * Whether the status shows the bound Entity present, over v1 and v2 alike. It is the later of two
 * measures: CrewLAN refuses the connection's writes from the moment no Client of the Entity is
 * attached, and shows it Offline only after a presence grace of 15 s. Unknown counts as present; a
 * refusal holds the buttons grey until a sign of presence (`ModuleInstance.presenceFrom`).
 */
function isEntityPresent(status: PublicEntityStatusDto | null): boolean {
	return status?.status.id !== offlineStatusId
}

function sameJson(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Order macro buttons the way CrewLAN asked for them.
 *
 * A macro that carries no usable `sortOrder` sorts after every macro that does, rather than as 0,
 * so an incomplete server list degrades to label order instead of jumping to the front.
 */
function macroSortKey(macro: PublicMacroDto): number {
	return typeof macro.sortOrder === 'number' && Number.isFinite(macro.sortOrder)
		? macro.sortOrder
		: Number.POSITIVE_INFINITY
}

export function compareMacros(a: PublicMacroDto, b: PublicMacroDto): number {
	const aKey = macroSortKey(a)
	const bKey = macroSortKey(b)

	if (aKey !== bKey) {
		return aKey < bKey ? -1 : 1
	}

	return a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
}

/** Sleep that resolves early when the connection is torn down, so no timer outlives destroy(). */
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted === true) {
		return
	}

	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		const onAbort = (): void => {
			clearTimeout(timer)
			resolve()
		}

		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

export { UpgradeScripts }

export interface ModuleSchema extends InstanceTypes {
	config: ModuleConfig
	secrets: ModuleSecrets | undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()

	private entityToken = ''
	private api: CrewLanApiClient | CrewLanV2Client | null = null
	private state: CrewLanState = createInitialState()

	/** Bumped on every (re)connect and cleanup; stale async work compares against it and bails. */
	private generation = 0
	private connectionAbort: AbortController | null = null
	private streamAbort: AbortController | null = null
	private pollTimer: NodeJS.Timeout | null = null
	private pollInFlight = false
	/** A snapshot was asked for while one was in flight; it runs once that one settles. */
	private pollAgain = false
	/** Over v2 the controls are read every second: nothing announces the audio connection's changes. */
	private controlsTimer: NodeJS.Timeout | null = null
	/**
	 * Set while a write CrewLAN refused because the Entity is not present holds the buttons grey,
	 * until a sign of presence: a status Offline shows only after the presence grace, so a snapshot
	 * read inside it still shows the chosen status. It carries CrewLAN's own time of the status held
	 * at the refusal, so a later status is told by CrewLAN's clock, never by this machine's.
	 */
	private ownerAbsence: { statusAt: number } | null = null
	/**
	 * What CrewLAN last said of whether the connection's target attends, and this machine's time it
	 * was said at — by the snapshot's `attends` (its time the one it was asked at), the stream's
	 * `attendance` record, an accepted write or a refusal naming the owner absent (the time its press
	 * was sent at, so a word CrewLAN said after the press stands). Null where CrewLAN says nothing of
	 * it (a Workspace predating it, or v1): `ownerAbsence` and the status then decide, as before.
	 * While it is set it alone decides whether the buttons grey.
	 */
	private attendance: { attends: boolean; at: number } | null = null
	/**
	 * Per Companion control, the requests its placed actions send, keyed by the action's own id, as
	 * Companion reports them (`actions.ts` `reportPlacement`). It outlives a connection: the buttons
	 * do not change when CrewLAN reconnects.
	 */
	private placedRequests = new Map<string, Map<string, readonly string[]>>()
	/** The caller ids whose names the snapshot was read again for, each asked once per connection. */
	private callerNamesAsked = new Set<string>()
	private reconnectTimer: NodeJS.Timeout | null = null
	private reconnectAttempt = 0
	private streamRestartTimer: NodeJS.Timeout | null = null
	private alertTimer: NodeJS.Timeout | null = null
	private streamRestartAttempt = 0
	/** When the current event stream was accepted, or 0 while no stream is open. */
	private streamOpenedAt = 0
	/** Serialises talk writes so a quick press/release can never be applied out of order. */
	private talkQueue: Promise<void> = Promise.resolve()
	/** The same for the listen channel, so a double-pressed mute toggle still ends up toggled. */
	private listenQueue: Promise<void> = Promise.resolve()
	/** When the response of the last local write was applied (for ordering against polls). */
	private lastLocalWriteAt = 0
	/** When `state.controls` was last refreshed from the server. */
	private controlsRefreshedAt = 0
	/** Over v2, when each macro's last run event arrived, so an older snapshot does not undo it. */
	private macroRunEventAt = new Map<string, number>()
	/** When the groups, with the Entity's own listening of each, were last read. */
	private groupsRefreshedAt = 0
	private registeredDefinitionsKey: string | null = null
	private instanceStatus: InstanceStatus | null = null
	private instanceStatusMessage: string | null = null
	private destroyed = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets | undefined): Promise<void> {
		this.applyConfig(config, secrets)
		this.updateDefinitions()
		this.updateVariableDefinitions()
		// Companion treats a slow init() as a stalled module and blocks the config UI until it returns,
		// so the connection is started here but never awaited; progress is reported via updateStatus().
		void this.connect()
	}

	async destroy(): Promise<void> {
		this.destroyed = true
		this.clearAlertTimer()
		this.cleanupConnection()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets | undefined): Promise<void> {
		this.applyConfig(config, secrets)
		this.cleanupConnection()
		this.updateState(createInitialState())
		void this.connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
		UpdateVariableValues(this)
	}

	/** Re-registers actions, feedbacks and presets; only needed when the buttons themselves change. */
	updateDefinitions(): void {
		this.registeredDefinitionsKey = this.definitionsKey()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
	}

	getCrewLanState(): CrewLanState {
		return this.state
	}

	getSelectableStatuses(): PublicStatusDto[] {
		return this.state.statuses.filter((status) => status.selectable)
	}

	getStatusChoices(): CrewLanChoice[] {
		const choices = this.getSelectableStatuses().map((status) => ({
			id: status.id,
			label: getCompanionStatusLabel(status),
		}))

		if (choices.length > 0) {
			return choices
		}

		return [{ id: '', label: '— status list not loaded —' }]
	}

	getDefaultStatusChoice(): string {
		return this.getStatusChoices()[0]?.id ?? ''
	}

	getRunnableMacros(): PublicMacroDto[] {
		return this.state.macros.filter((macro) => macro.runnable).sort(compareMacros)
	}

	getMacroChoices(): CrewLanChoice[] {
		const choices = this.getRunnableMacros().map((macro) => ({ id: macro.id, label: macro.label }))

		if (choices.length > 0) {
			return choices
		}

		return [{ id: '', label: '— macro list not loaded —' }]
	}

	getDefaultMacroChoice(): string {
		return this.getMacroChoices()[0]?.id ?? ''
	}

	isMacroRunning(macroId: string): boolean {
		return macroId.length > 0 && this.state.macros.some((macro) => macro.id === macroId && macro.running)
	}

	/** Records that the control `controlId` holds the placed action `actionId`, which sends `requests`. */
	notePlacedAction(controlId: string, actionId: string, requests: readonly string[]): void {
		const placed = this.placedRequests.get(controlId) ?? new Map<string, readonly string[]>()

		placed.set(actionId, requests)
		this.placedRequests.set(controlId, placed)
		this.recheckReadiness()
	}

	/** Forgets the placed action `actionId` of the control `controlId`: removed, disabled or edited. */
	noteRemovedAction(controlId: string, actionId: string): void {
		const placed = this.placedRequests.get(controlId)

		if (placed === undefined || !placed.delete(actionId)) {
			return
		}

		if (placed.size === 0) {
			this.placedRequests.delete(controlId)
		}

		this.recheckReadiness()
	}

	/**
	 * Whether the offer holds every request the actions placed on `controlId` send. True over v1,
	 * which says no offer, and for a control the module knows no action of: such a button keeps
	 * reading ready while it is connected and its target attends, as it did before.
	 */
	isControlOffered(controlId: string | undefined): boolean {
		const placed = controlId === undefined ? undefined : this.placedRequests.get(controlId)

		if (placed === undefined) {
			return true
		}

		return [...placed.values()].every((requests) => requests.every((wireId) => isOffered(this.state, wireId)))
	}

	private recheckReadiness(): void {
		// Over v1, and before the first offer, every control reads ready whatever it holds.
		if (this.state.requests === null) {
			return
		}

		const [first, ...others] = feedbackIdsForGroups(new Set<StateGroup>(['connection']))

		if (first !== undefined) {
			this.checkFeedbacks(first, ...others)
		}
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	/**
	 * Rebuild the connection. It deliberately does not await the reconnect: a full snapshot is seven
	 * requests and Companion abandons an action after 5 s. Progress is reported through the
	 * instance status instead.
	 */
	refreshCrewLan(): void {
		this.log('info', 'Reconnecting to CrewLAN…')
		void this.connect()
	}

	async runCrewLanAction(actionName: string, action: () => Promise<void>): Promise<void> {
		const sentAt = Date.now()

		try {
			await action()
		} catch (error) {
			if (isAbortError(error)) {
				this.log('debug', `${actionName}: cancelled because the connection was reset.`)
				return
			}

			this.handleOperationError(actionName, error, sentAt)
		}
	}

	async setCrewLanStatus(statusId: string): Promise<void> {
		const requestedId = statusId.trim()

		if (requestedId.length === 0) {
			this.log('warn', 'Set My Status: no status selected. Pick one once the connection is up, or type a status id.')
			return
		}

		if (this.state.statuses.length > 0 && !this.state.statuses.some((status) => status.id === requestedId)) {
			const known = this.getSelectableStatuses()
				.map((status) => status.id)
				.join(', ')
			this.log('warn', `Set My Status: CrewLAN has no status with id "${requestedId}". Known ids: ${known}`)
			return
		}

		const api = this.requireApi()
		const entityId = this.requireEntityId()
		const generation = this.generation
		const result = await api.setEntityStatus(entityId, requestedId, this.requestOptions())

		if (generation !== this.generation) {
			return
		}

		this.lastLocalWriteAt = Date.now()
		this.notePresent()
		// The write succeeded but could not be re-read: reflect it from the local status list until
		// the next event or poll settles it.
		const applied =
			result.status ??
			(() => {
				const status = this.state.statuses.find((candidate) => candidate.id === result.selectedStatusId)

				return status === undefined
					? null
					: { entityId, status, selectedStatusId: result.selectedStatusId, updatedAt: null }
			})()

		if (applied === null) {
			this.updateState({ lastError: '' })
			return
		}

		this.applyStatusUpdate(applied, this.lastLocalWriteAt, { lastError: '' })
	}

	/**
	 * Sets a status indicator's status, v2 only. An indicator the offer does not list, or a status it
	 * does not list for it, is refused here with the reason, and nothing is sent.
	 */
	async setIndicatorStatus(indicatorId: string, statusId: string): Promise<void> {
		const actionName = 'Set Indicator Status'
		const requestedIndicator = indicatorId.trim()
		const requestedStatus = statusId.trim()
		const api = this.requireIntegrationApi(actionName)

		if (api === null) {
			return
		}

		if (requestedIndicator.length === 0 || requestedStatus.length === 0) {
			this.log(
				'warn',
				`${actionName}: no status indicator or no status selected. Pick both once the connection is up, or type their ids.`,
			)
			return
		}

		const indicator = this.state.indicators.find((candidate) => candidate.id === requestedIndicator)

		if (indicator === undefined) {
			this.log(
				'warn',
				`${actionName}: CrewLAN does not let this connection set the status indicator "${requestedIndicator}" now, so nothing was sent.`,
			)
			return
		}

		if (!indicator.statusIds.includes(requestedStatus)) {
			this.log(
				'warn',
				`${actionName}: CrewLAN does not let this connection set ${indicator.name} to "${requestedStatus}", so nothing was sent. It may set: ${indicator.statusIds.join(', ')}`,
			)
			return
		}

		this.requireEntityId()
		const generation = this.generation
		const indicators = await api.setIndicatorStatus(requestedIndicator, requestedStatus, this.requestOptions())

		if (generation !== this.generation) {
			return
		}

		this.lastLocalWriteAt = Date.now()
		this.notePresent()
		this.updateState({ indicators, lastError: '' })
	}

	/**
	 * Start a macro. One-shot: CrewLAN answers with the updated macro, and a 409 for a macro that is
	 * already running surfaces as an ordinary action failure without touching the connection.
	 */
	async runCrewLanMacro(macroId: string): Promise<void> {
		const requestedId = macroId.trim()

		if (requestedId.length === 0) {
			this.log('warn', 'Run Macro: no macro selected. Pick one once the connection is up, or type a macro id.')
			return
		}

		if (this.state.macros.length > 0 && !this.state.macros.some((macro) => macro.id === requestedId)) {
			const known = this.getRunnableMacros()
				.map((macro) => macro.id)
				.join(', ')
			this.log('warn', `Run Macro: CrewLAN has no macro with id "${requestedId}". Known ids: ${known}`)
			return
		}

		const api = this.requireApi()
		this.requireEntityId()
		const generation = this.generation
		const macro = await api.runMacro(requestedId, this.requestOptions())

		if (generation !== this.generation) {
			return
		}

		this.lastLocalWriteAt = Date.now()
		this.notePresent()
		// Over v2 a run leaves the macro's updatedAt as it was, so its answer, arriving after a fast
		// run's macroRunEnded, would light it again: there `running` comes from the run events and
		// the snapshot alone.
		const held = this.state.macros.find((candidate) => candidate.id === macro.id)
		this.applyMacroUpdate(
			api instanceof CrewLanV2Client ? { ...macro, running: held?.running ?? false } : macro,
			this.lastLocalWriteAt,
		)
		this.updateState({ lastError: '' })
	}

	async setListenMuteMode(mode: 'toggle' | 'on' | 'off'): Promise<void> {
		// The target is decided inside the queue: two presses in quick succession must not both read
		// the same held state and send the same value, which would leave the toggle where it was.
		await this.enqueueListenWrite(async () => {
			const muted = mode === 'toggle' ? (await this.currentControls())?.shoutbox.listen.muted !== true : mode === 'on'

			await this.patchControls({ shoutbox: { listen: { muted } } })
		})
	}

	async setTalkLatchMode(mode: 'toggle' | 'on' | 'off'): Promise<void> {
		await this.enqueueTalkWrite(async () => {
			const active = mode === 'toggle' ? (await this.currentControls())?.shoutbox.talk.active !== true : mode === 'on'

			await this.writeTalkState(active, 'latch')
		})
	}

	async setTalkState(active: boolean, controlMode: 'push' | 'latch'): Promise<void> {
		await this.enqueueTalkWrite(async () => {
			await this.writeTalkState(active, controlMode)
		})
	}

	/** The talk write itself. Callers are responsible for running it inside the talk queue. */
	private async writeTalkState(active: boolean, controlMode: 'push' | 'latch'): Promise<void> {
		if (active) {
			await this.patchControls({ shoutbox: { talk: { active: true, controlMode } } })
		} else {
			await this.releaseTalk(`Global Talk (${controlMode})`, async (options) => {
				await this.patchControls({ shoutbox: { talk: { active: false, controlMode: null } } }, options)
			})
		}
	}

	/** The input mute (*Input*), v2 only; decided inside the listen queue, as Output's toggle is. */
	async setInputMuteMode(mode: 'toggle' | 'on' | 'off'): Promise<void> {
		const api = this.requireIntegrationApi('Input')

		if (api === null) {
			return
		}

		await this.enqueueListenWrite(async () => {
			const inputMuted = mode === 'toggle' ? this.state.intercom?.inputMuted !== true : mode === 'on'

			await this.writeIntegrationControls(api, { inputMuted })
		})
	}

	/**
	 * Holds (`held`) or lets go one group's talk key, `push` or `latch`, v2 only. Letting go is sent
	 * and retried as Global Talk's release is: a lost release leaves the microphone open.
	 */
	async setGroupTalk(groupId: string, held: boolean, talkKey: 'push' | 'latch'): Promise<void> {
		const api = this.requireIntegrationApi('Talk')

		if (api === null) {
			return
		}

		await this.enqueueTalkWrite(async () => {
			await this.writeGroupTalk(api, groupId, held, talkKey)
		})
	}

	/** Latches, unlatches or toggles one group's talk key, decided inside the talk queue, v2 only. */
	async setGroupTalkLatchMode(groupId: string, mode: 'toggle' | 'on' | 'off'): Promise<void> {
		const api = this.requireIntegrationApi('Talk')

		if (api === null) {
			return
		}

		await this.enqueueTalkWrite(async () => {
			const held =
				mode === 'toggle'
					? this.state.intercom?.groups.find((group) => group.id === groupId)?.talkHeld !== true
					: mode === 'on'

			await this.writeGroupTalk(api, groupId, held, 'latch')
		})
	}

	/** Mutes, unmutes or toggles the participant's listening of one group, keeping its level, v2 only. */
	async setGroupMuteMode(groupId: string, mode: 'toggle' | 'on' | 'off'): Promise<void> {
		const api = this.requireIntegrationApi('Mute')

		if (api === null) {
			return
		}

		await this.enqueueListenWrite(async () => {
			// Nothing announces the Entity's own listening, so a toggle decides from a fresh read, as
			// Output's toggle does from currentControls().
			if (mode === 'toggle' && Date.now() - this.groupsRefreshedAt > this.pollIntervalMs()) {
				await this.refreshIntercom(this.generation, 'groups')
			}

			const group = this.requireMemberGroup(groupId, 'Mute')

			if (group === null) {
				return
			}

			const muted = mode === 'toggle' ? !group.muted : mode === 'on'
			const generation = this.generation
			await api.setListening(groupId, muted, this.requestOptions())

			if (generation === this.generation) {
				this.lastLocalWriteAt = Date.now()
				this.notePresent()
				this.updateState({ intercom: api.intercomState(), lastError: '' })
			}
		})
	}

	/** Answers the direct call ringing the participant (*Answer*), v2 only; with none it logs so and sends nothing. */
	async answerCall(): Promise<void> {
		const api = this.requireIntegrationApi('Answer')
		const caller = this.state.intercom?.ringing ?? null

		if (api === null) {
			return
		}

		if (caller === null) {
			this.log('info', 'Answer: nobody is calling.')
			return
		}

		await this.enqueueTalkWrite(async () => {
			await this.writeIntegrationControls(api, { call: { callerId: caller.id } })
		})
	}

	/**
	 * Holds (`held`) or lets go the active direct call's Talk key, `push` or `latch`, v2 only. CrewLAN
	 * refuses a hold without an active call; letting go is sent and retried as Global Talk's release is.
	 */
	async setCallTalk(held: boolean, talkKey: 'push' | 'latch'): Promise<void> {
		const api = this.requireIntegrationApi('Direct Talk')

		if (api === null) {
			return
		}

		await this.enqueueTalkWrite(async () => {
			await this.writeCallTalk(api, held, talkKey)
		})
	}

	/** Latches, unlatches or toggles the direct call's Talk key, decided inside the talk queue, v2 only. */
	async setCallTalkLatchMode(mode: 'toggle' | 'on' | 'off'): Promise<void> {
		const api = this.requireIntegrationApi('Direct Talk')

		if (api === null) {
			return
		}

		await this.enqueueTalkWrite(async () => {
			const held = mode === 'toggle' ? this.state.intercom?.callTalkHeld !== true : mode === 'on'

			await this.writeCallTalk(api, held, 'latch')
		})
	}

	/**
	 * Hangs up the active direct call, or cancels the participant's own ringing one (*Hang up*), v2
	 * only; with neither it changes nothing.
	 */
	async hangUpCall(): Promise<void> {
		const api = this.requireIntegrationApi('Hang up')

		if (api === null) {
			return
		}

		await this.enqueueTalkWrite(async () => {
			await this.writeIntegrationControls(api, { call: null })
		})
	}

	/** The v2 client, or null after logging that `actionName` needs `/api/v2`. */
	private requireIntegrationApi(actionName: string): CrewLanV2Client | null {
		const api = this.requireApi()

		if (api instanceof CrewLanV2Client) {
			return api
		}

		this.log('warn', needsIntegrationApiMessage(actionName))
		return null
	}

	/**
	 * A group the participant is a member of, or null after logging why not: a group left or removed
	 * keeps its buttons, and a press on one must say what went wrong.
	 */
	private requireMemberGroup(groupId: string, actionName: string): IntercomGroupState | null {
		const group = this.state.intercom?.groups.find((candidate) => candidate.id === groupId) ?? null

		if (group === null) {
			this.log(
				'error',
				`${actionName}: you are not a member of the intercom group "${groupId}", or it no longer exists.`,
			)
		}

		return group
	}

	private async writeGroupTalk(
		api: CrewLanV2Client,
		groupId: string,
		held: boolean,
		talkKey: 'push' | 'latch',
	): Promise<void> {
		if (!held) {
			// Letting go is never refused, a group the module no longer knows included.
			const name = this.state.intercom?.groups.find((group) => group.id === groupId)?.name ?? groupId
			await this.releaseTalk(`Talk on ${name}`, async (options) => {
				await this.writeIntegrationControls(api, { groupTalk: { groupId, held: false } }, options)
			})
			return
		}

		if (this.requireMemberGroup(groupId, 'Talk') === null) {
			return
		}

		await this.writeIntegrationControls(api, { groupTalk: { groupId, held: true, talkKey } })
	}

	private async writeCallTalk(api: CrewLanV2Client, held: boolean, talkKey: 'push' | 'latch'): Promise<void> {
		if (held) {
			await this.writeIntegrationControls(api, { callTalk: { held: true, talkKey } })
		} else {
			await this.releaseTalk('Direct Talk', async (options) => {
				await this.writeIntegrationControls(api, { callTalk: { held: false } }, options)
			})
		}
	}

	/** One `intercom.command.setControls`, its answer applied as a controls patch's is. */
	private async writeIntegrationControls(
		api: CrewLanV2Client,
		body: IntegrationControlsBody,
		options: RequestOptions = {},
	): Promise<void> {
		const entityId = this.requireEntityId()
		const generation = this.generation
		const controls = await api.setControls(entityId, body, this.requestOptions(options))

		if (generation !== this.generation) {
			return
		}

		this.lastLocalWriteAt = Date.now()

		// A release is answered while the Entity is absent too, so only another write shows presence.
		if (body.globalTalk !== false && body.groupTalk?.held !== false && body.callTalk?.held !== false) {
			this.notePresent()
		}

		this.applyControlsUpdate(controls, this.lastLocalWriteAt, { lastError: '' })
	}

	async dismissAlerts(): Promise<void> {
		const api = this.requireApi()
		const entityId = this.requireEntityId()
		const generation = this.generation

		await api.dismissEntityAlerts(entityId, this.requestOptions())

		if (generation !== this.generation) {
			return
		}

		this.clearAlertTimer()
		this.updateState({ lastAlert: '', lastError: '' })
	}

	// ---------------------------------------------------------------------------
	// Config
	// ---------------------------------------------------------------------------

	private applyConfig(config: ModuleConfig, secrets: ModuleSecrets | undefined): void {
		// The upgrade script performs this migration when Companion loads an old config; running it
		// again here is a deliberate belt-and-braces fallback for configs that bypassed the upgrade
		// path (imports, manual edits). It is a no-op once the token lives in the secret store.
		const migration = migrateLegacyEntityToken(config, secrets)
		this.config = migration.config
		this.entityToken = resolveEntityToken(migration.config, migration.secrets)

		if (migration.migrated) {
			this.saveConfig(migration.config, migration.secrets)
		}
	}

	private pollIntervalMs(): number {
		return resolvePollIntervalMs(this.config)
	}

	// ---------------------------------------------------------------------------
	// Connection lifecycle
	// ---------------------------------------------------------------------------

	private async connect(): Promise<void> {
		this.cleanupConnection()

		if (this.destroyed) {
			return
		}

		const generation = ++this.generation
		const abort = new AbortController()
		this.connectionAbort = abort
		this.setInstanceStatus(InstanceStatus.Connecting)

		try {
			const logger = {
				debug: (message: string): void => this.log('debug', message),
				warn: (message: string): void => this.log('warn', message),
			}
			const http = new CrewLanApiClient({ baseUrl: this.config.baseUrl, token: this.entityToken, logger })
			// One API per connection, asked at every connect: a Workspace may gain or lose /api/v2
			// between two runs, and a 404 here leaves the Public API v1 path exactly as it was.
			const description = await probeIntegrationApi(http, { signal: abort.signal })

			if (generation !== this.generation) {
				return
			}

			const api = description === null ? http : new CrewLanV2Client(http, description, logger)
			this.api = api
			// A connection that has not read its snapshot yet counts its Entity as present.
			this.ownerAbsence = null
			this.attendance = null
			this.callerNamesAsked.clear()
			this.updateState({
				api: description === null ? 'v1' : 'v2',
				ownerPresent: true,
				...(api instanceof CrewLanV2Client
					? { requests: api.offeredRequests(), indicators: api.indicators() }
					: { requests: null, indicators: [], targetKind: null }),
			})
			await this.loadSnapshot(generation, abort.signal)
		} catch (error) {
			if (generation !== this.generation || isAbortError(error)) {
				return
			}

			this.api = null
			this.handleConnectionError(error)

			// A timer cannot fix an unusable configuration, and Companion calls configUpdated() as soon
			// as the operator corrects it, which rebuilds the connection anyway. Retrying would only
			// repeat the same warning in the log for as long as the connection stays unconfigured.
			if (!isConfigurationError(error)) {
				this.scheduleReconnect(error)
			}

			return
		}

		if (generation !== this.generation) {
			return
		}

		this.reconnectAttempt = 0
		this.setInstanceStatus(InstanceStatus.Ok)
		this.startEventStream(generation)
		this.schedulePoll(generation)
		this.scheduleControlsRead(generation)
	}

	private cleanupConnection(): void {
		this.generation++
		this.api = null
		this.pollInFlight = false
		// The stream backoff belongs to the connection being torn down; a rebuilt connection starts
		// its stream fresh, and a stale count here would also fake a "restarted" resync snapshot.
		this.streamRestartAttempt = 0
		this.streamOpenedAt = 0
		this.clearReconnectTimer()
		this.clearPollTimer()
		this.clearControlsTimer()
		this.pollAgain = false
		this.clearStreamRestartTimer()
		this.stopEventStream()

		if (this.connectionAbort !== null) {
			this.connectionAbort.abort()
			this.connectionAbort = null
		}

		if (this.state.streamConnected) {
			this.updateState({ streamConnected: false })
		}
	}

	private requestOptions(extra: RequestOptions = {}): RequestOptions {
		const signal = this.connectionAbort?.signal

		return signal === undefined ? extra : { ...extra, signal }
	}

	private async loadSnapshot(generation: number, signal: AbortSignal | undefined): Promise<void> {
		const api = this.requireApi()
		const options: RequestOptions = signal === undefined ? {} : { signal }

		if (api instanceof CrewLanV2Client) {
			await this.loadIntegrationSnapshot(api, generation, options)
			return
		}

		const requestedAt = Date.now()
		const session = await api.getSession(options)
		const grantedEntities = session.entities.filter((entity) => entity.granted)

		if (grantedEntities.length !== 1) {
			throw new CrewLanApiError('The token must grant exactly one CrewLAN entity capability.')
		}

		const entityId = grantedEntities[0]?.entityId ?? ''

		if (entityId.length === 0) {
			throw new CrewLanApiError('The token did not contain a CrewLAN entity id.')
		}

		const [workspace, entity, statuses, status, controls, macros] = await Promise.all([
			api.getWorkspace(options),
			api.getEntity(entityId, options),
			api.listStatuses(options),
			api.getEntityStatus(entityId, options),
			api.getEntityControls(entityId, options),
			api.listMacros(options),
		])

		if (generation !== this.generation) {
			return
		}

		const nextStatus = pickFresher(this.state.status, status, requestedAt, this.lastLocalWriteAt)
		const nextControls = pickFresher(this.state.controls, controls, requestedAt, this.lastLocalWriteAt)

		if (nextControls === controls) {
			this.controlsRefreshedAt = Date.now()
		}

		this.updateState({
			connected: true,
			entityId,
			workspace,
			entity,
			statuses,
			// The server's list membership and ordering win; only a per-macro payload can be held back.
			macros: macros === null ? [] : this.mergeMacros(macros, requestedAt),
			macrosSupported: macros !== null,
			status: nextStatus,
			controls: nextControls,
			ownerPresent: this.presenceFrom(nextStatus),
			lastError: '',
		})
		this.setInstanceStatus(InstanceStatus.Ok)
	}

	/**
	 * The `/api/v2` snapshot: one read of the snapshot, and of the controls and the groups where the
	 * offer holds their reads, in v1's shapes. Until the open stream has written an `offer` record —
	 * none open, or a CrewLAN whose stream writes none (2.0.x) — `GET /api/v2` is read again first,
	 * so a poll never asks for what the connection may no longer read.
	 *
	 * A read the offer held, refused `403`, says the offer is stale, not the token refused: CrewLAN
	 * judges a token's next request by a changed target at once, while the stream that tells the new
	 * offer ends only at its next tick, up to a second later. The offer is read again then, and the
	 * snapshot once more; a refused token is refused that too, and fails the connection.
	 */
	private async loadIntegrationSnapshot(
		api: CrewLanV2Client,
		generation: number,
		options: RequestOptions,
	): Promise<void> {
		if (this.state.connected && !(this.state.streamConnected && api.streamTellsOffer)) {
			await api.readOffer(options)
		}

		let requestedAt = Date.now()
		let snapshot: IntegrationState

		try {
			snapshot = await api.loadSnapshot(options)
		} catch (error) {
			if (!(error instanceof CrewLanApiError && error.statusCode === 403)) {
				throw error
			}

			this.log(
				'debug',
				`CrewLAN refused a read this connection's offer held (${describeError(error)}); reading what it may do again.`,
			)
			await api.readOffer(options)
			requestedAt = Date.now()
			snapshot = await api.loadSnapshot(options)
		}

		if (generation !== this.generation) {
			return
		}

		// Another target — the connection given a status indicator — keeps no status or controls of
		// the one it left.
		const sameTarget = snapshot.entityId === this.state.entityId
		const heldStatus = sameTarget ? this.state.status : null
		const nextStatus =
			snapshot.status === null
				? heldStatus
				: pickFresher(heldStatus, snapshot.status, requestedAt, this.lastLocalWriteAt)
		const nextControls =
			snapshot.controls === null
				? null
				: pickFresher(sameTarget ? this.state.controls : null, snapshot.controls, requestedAt, this.lastLocalWriteAt)

		if (nextControls !== null && nextControls === snapshot.controls) {
			this.controlsRefreshedAt = Date.now()
		}

		if (snapshot.attends !== null && (this.attendance === null || requestedAt >= this.attendance.at)) {
			this.attendance = { attends: snapshot.attends, at: requestedAt }
		}

		this.groupsRefreshedAt = Date.now()
		this.updateState({
			connected: true,
			entityId: snapshot.entityId,
			workspace: snapshot.workspace,
			entity: snapshot.entity,
			targetKind: snapshot.targetKind,
			statuses: snapshot.statuses,
			// A run event after this snapshot was asked for knows better whether the macro runs.
			macros: this.mergeMacros(snapshot.macros, requestedAt).map((macro) => {
				const held = this.state.macros.find((candidate) => candidate.id === macro.id)

				return held !== undefined && (this.macroRunEventAt.get(macro.id) ?? 0) >= requestedAt
					? { ...macro, running: held.running }
					: macro
			}),
			macrosSupported: api.offers(wireRequests.listMacros),
			status: nextStatus,
			controls: nextControls,
			intercom: snapshot.intercom,
			ownerPresent: this.presenceFrom(nextStatus),
			// The offer as it stands now: an `offer` record may have arrived while the snapshot was read.
			requests: api.offeredRequests(),
			indicators: api.indicators(),
			lastError: '',
		})
		this.setInstanceStatus(InstanceStatus.Ok)
	}

	// ---------------------------------------------------------------------------
	// Event stream
	// ---------------------------------------------------------------------------

	private startEventStream(generation: number): void {
		const api = this.api

		if (api === null || generation !== this.generation || this.destroyed) {
			return
		}

		this.stopEventStream()

		const controller = new AbortController()
		this.streamAbort = controller

		api
			.streamEvents({
				signal: controller.signal,
				idleTimeoutMs: eventStreamIdleTimeoutMs,
				// The snapshot has already run, so this is known. A host that grows macro support later
				// is picked up by the poll, and its events on the next reconnect.
				includeMacroEvents: this.state.macrosSupported,
				onOpen: () => this.handleStreamOpen(generation),
				onEvent: (event) => {
					if (generation === this.generation) {
						// The bound Entity's own Offline, held back until it is present again, is the one
						// frame that does not say it is; v2's entityStatusChanged arrives as status.changed.
						if (!this.isOwnOffline(event)) {
							this.notePresentByStream()
						}

						this.applyEvent(event)
					}
				},
				onIntegrationEvent: (event) => {
					if (generation === this.generation) {
						this.applyIntegrationEvent(event, generation)
					}
				},
				// What the stream missed cannot be replayed: the snapshot, controls and groups are read
				// again at once.
				onGap: () => {
					if (generation === this.generation) {
						this.notePresentByStream()
						this.log('debug', 'CrewLAN event stream missed events; reading the Workspace again.')
						this.schedulePoll(generation, 0)
					}
				},
				onAttendance: (attends) => {
					if (generation === this.generation) {
						this.applyAttendance(attends)
					}
				},
				onOffer: () => {
					if (generation === this.generation && api instanceof CrewLanV2Client) {
						this.applyOffer(api, generation)
					}
				},
			})
			.then(
				() =>
					this.handleStreamLost(
						generation,
						controller,
						new CrewLanApiError('The CrewLAN event stream was closed by the server.', null, 'network'),
					),
				(error: unknown) => this.handleStreamLost(generation, controller, error),
			)
	}

	private stopEventStream(): void {
		if (this.streamAbort !== null) {
			this.streamAbort.abort()
			this.streamAbort = null
		}
	}

	private handleStreamOpen(generation: number): void {
		if (generation !== this.generation) {
			return
		}

		const wasRestarting = this.streamRestartAttempt > 0
		// The handshake alone does not clear the backoff. A host that accepts the stream and drops it
		// again immediately would otherwise make every loss look like the first one, so the delay
		// would never grow past its one second floor. handleStreamLost() decides that instead, from
		// how long the stream actually stood.
		this.streamOpenedAt = Date.now()
		this.updateState({ streamConnected: true })
		this.log('debug', 'CrewLAN event stream connected.')
		// Events missed while the stream was down cannot be replayed: resync right away, then drop
		// back to the slow reconciliation cadence.
		this.schedulePoll(generation, wasRestarting ? 0 : undefined)
	}

	private handleStreamLost(generation: number, controller: AbortController, error: unknown): void {
		if (controller.signal.aborted || generation !== this.generation || this.destroyed) {
			return
		}

		this.streamAbort = null
		this.updateState({ streamConnected: false })

		if (isNonRecoverableStatus(statusForError(error))) {
			this.handleConnectionError(error)
			this.scheduleReconnect(error)
			return
		}

		// A stream that stood long enough was healthy, so its loss starts the backoff over. One that
		// was accepted and lost again straight away keeps escalating towards the 30 s cap, and only
		// the first of those losses is a warning.
		if (this.streamOpenedAt > 0 && Date.now() - this.streamOpenedAt >= streamStableAfterMs) {
			this.streamRestartAttempt = 0
		}

		this.streamOpenedAt = 0
		const attempt = this.streamRestartAttempt++
		const delayMs = computeReconnectDelayMs(attempt, InstanceStatus.ConnectionFailure)
		this.log(
			attempt === 0 ? 'warn' : 'debug',
			`CrewLAN event stream lost: ${describeError(error)} Polling every ${String(this.pollIntervalMs())} ms and retrying the stream in ${String(delayMs)} ms.`,
		)
		// Poll immediately so state is refreshed and a dead server is detected without waiting.
		this.schedulePoll(generation, 0)
		this.clearStreamRestartTimer()
		this.streamRestartTimer = setTimeout(() => {
			this.streamRestartTimer = null
			this.startEventStream(generation)
		}, delayMs)
	}

	private clearStreamRestartTimer(): void {
		if (this.streamRestartTimer !== null) {
			clearTimeout(this.streamRestartTimer)
			this.streamRestartTimer = null
		}
	}

	// ---------------------------------------------------------------------------
	// Polling
	// ---------------------------------------------------------------------------

	private schedulePoll(generation: number, delayMs?: number): void {
		this.clearPollTimer()

		if (generation !== this.generation || this.destroyed) {
			return
		}

		const fallback = this.pollIntervalMs()
		const interval = this.state.streamConnected ? Math.max(fallback, streamHealthyPollIntervalMs) : fallback

		this.pollTimer = setTimeout(() => {
			this.pollTimer = null
			void this.runPoll(generation)
		}, delayMs ?? interval)
	}

	private clearPollTimer(): void {
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}
	}

	private async runPoll(generation: number): Promise<void> {
		if (generation !== this.generation) {
			return
		}

		if (this.pollInFlight) {
			// The snapshot in flight may have been read before what asked for this one; one more runs
			// once it settles.
			this.pollAgain = true
			return
		}

		this.pollInFlight = true

		try {
			await this.loadSnapshot(generation, this.connectionAbort?.signal)
		} catch (error) {
			if (generation !== this.generation || isAbortError(error)) {
				return
			}

			this.handleConnectionError(error)
			this.scheduleReconnect(error)
			return
		} finally {
			this.pollInFlight = false
		}

		const again = this.pollAgain
		this.pollAgain = false
		this.schedulePoll(generation, again ? 0 : undefined)
	}

	/**
	 * Over v2, reads `intercom.query.getControls` every second while connected: the audio
	 * connection and the microphone's sending change without an event the integration API streams,
	 * and v1's stream reads them 4×/s for the same reason. One read a second stays far below the
	 * integration API's 20 requests/s.
	 */
	private scheduleControlsRead(generation: number): void {
		this.clearControlsTimer()

		if (generation !== this.generation || this.destroyed || !(this.api instanceof CrewLanV2Client)) {
			return
		}

		this.controlsTimer = setTimeout(() => {
			this.controlsTimer = null
			void this.refreshIntercom(generation, 'controls').then(() => {
				// A read in flight while the connection broke must not re-arm the timer.
				if (this.state.connected) {
					this.scheduleControlsRead(generation)
				}
			})
		}, integrationControlsReadIntervalMs)
	}

	private clearControlsTimer(): void {
		if (this.controlsTimer !== null) {
			clearTimeout(this.controlsTimer)
			this.controlsTimer = null
		}
	}

	// ---------------------------------------------------------------------------
	// Reconnect
	// ---------------------------------------------------------------------------

	private scheduleReconnect(error: unknown): void {
		// Nothing useful can happen on the dead connection until it is rebuilt.
		this.clearPollTimer()
		this.clearControlsTimer()
		this.clearStreamRestartTimer()
		this.stopEventStream()

		if (this.reconnectTimer !== null || this.destroyed) {
			return
		}

		const delayMs = computeReconnectDelayMs(this.reconnectAttempt++, statusForError(error))
		this.log('debug', `Reconnecting to CrewLAN in ${String(delayMs)} ms.`)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			void this.connect()
		}, delayMs)
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	// ---------------------------------------------------------------------------
	// Events
	// ---------------------------------------------------------------------------

	private applyEvent(event: PublicEventEnvelope): void {
		switch (event.type) {
			case 'status.changed':
				if (isPublicEntityStatusDto(event.data)) {
					this.applyStatusUpdate(event.data, Date.now())
				} else {
					this.log('debug', 'Ignoring status.changed event with an unexpected payload.')
				}
				return
			case 'entity.controls.changed':
				if (isPublicEntityControlsDto(event.data)) {
					this.applyControlsUpdate(event.data, Date.now())
				} else {
					this.log('debug', 'Ignoring entity.controls.changed event with an unexpected payload.')
				}
				return
			case 'macro.changed':
			case 'macro.removed':
				// The macro list endpoint decides whether this host has macros (see the 404 rule). A
				// host that answers 404 there but still broadcasts macro events must not make macro
				// buttons appear and vanish again on the next snapshot.
				if (!this.state.macrosSupported) {
					this.log('debug', `Ignoring ${event.type} from a CrewLAN without macro support.`)
					return
				}

				this.applyMacroEvent(event)
				return
			case 'alert.triggered':
				if (isPublicAlertTriggeredEventData(event.data)) {
					this.applyAlertEvent(event.occurredAt, event.data.scope, event.data.targetEntityIds)
				} else {
					this.log('debug', 'Ignoring alert.triggered event with an unexpected payload.')
				}
				return
			default:
				this.log('debug', `Ignoring unknown CrewLAN event type "${String(event.type)}".`)
		}
	}

	/**
	 * The `/api/v2` events v1 has no shape for. A run's start and end carry the macro's id alone; the
	 * controls and the groups are read again, because their events do not carry all the module shows
	 * (the audio connection, the Entity's own listening of a group).
	 */
	private applyIntegrationEvent(event: IntegrationEventEnvelope, generation: number): void {
		const { payload } = event

		// Its own Offline, held back until the Entity is present again, is the one frame that does
		// not say it is.
		if (!(
			event.wireId === 'status.event.entityStatusChanged' &&
			payload.entityId === this.state.entityId &&
			payload.statusId === 'offline'
		)) {
			this.notePresentByStream()
		}

		switch (event.wireId) {
			case 'macros.event.macroRunStarted':
			case 'macros.event.macroRunEnded':
				if (typeof payload.macroId === 'string') {
					this.setMacroRunning(payload.macroId, event.wireId === 'macros.event.macroRunStarted')
				}
				return
			case 'intercom.event.controlsChanged':
				if (payload.entityId === this.state.entityId) {
					void this.refreshIntercom(generation, 'controls')
				}
				return
			case 'intercom.event.groupCreated':
			case 'intercom.event.groupChanged':
			case 'intercom.event.groupRemoved':
			case 'intercom.event.memberAdded':
			case 'intercom.event.memberRemoved':
				void this.refreshIntercom(generation, 'groups')
				return
			case 'status.event.indicatorStatusChanged':
			case 'entities.event.indicatorUpdated':
				this.applyIndicatorEvent(event, generation)
				return
			case 'status.event.statusDefined':
			case 'status.event.statusUpdated':
			case 'status.event.statusRemoved':
			case 'status.event.entityStatusChanged':
				// A status the catalogue does not hold yet, or the catalogue itself changed: the snapshot
				// carries both.
				this.schedulePoll(generation, 0)
				return
			default:
				this.log('debug', `Ignoring CrewLAN event "${event.wireId}".`)
		}
	}

	/**
	 * The stream's `attendance` record: the buttons grey the moment the target stops attending and
	 * come back the moment it attends again, with no grace.
	 */
	private applyAttendance(attends: boolean): void {
		this.attendance = { attends, at: Date.now() }
		this.ownerAbsence = null

		if (this.state.ownerPresent !== attends) {
			this.log('debug', attends ? 'CrewLAN: the target attends again.' : 'CrewLAN: the target attends at no Client.')
			this.updateState({ ownerPresent: attends })
		}
	}

	/**
	 * The stream's `offer` record, already the client's: a button whose request left the offer greys
	 * at once, and the snapshot is read again for what the new offer shows — a newly settable
	 * indicator's name, the macros' `runnable`, the controls a newly offered read returns.
	 */
	private applyOffer(api: CrewLanV2Client, generation: number): void {
		const requests = api.offeredRequests()
		const indicators = api.indicators()
		const offered = (list: CrewLanState['indicators']) => list.map((indicator) => [indicator.id, indicator.statusIds])

		if (sameJson(requests, this.state.requests) && sameJson(offered(indicators), offered(this.state.indicators))) {
			return
		}

		this.log('debug', 'CrewLAN changed what this connection may do; reading the Workspace again.')
		this.updateState({
			requests,
			indicators,
			...(api.offers(wireRequests.getControls) ? {} : { controls: null, intercom: null }),
		})
		this.schedulePoll(generation, 0)
	}

	private setMacroRunning(macroId: string, running: boolean): void {
		this.macroRunEventAt.set(macroId, Date.now())
		const index = this.state.macros.findIndex((macro) => macro.id === macroId)
		const current = index < 0 ? undefined : this.state.macros[index]

		if (current === undefined || current.running === running) {
			return
		}

		this.updateState({ macros: this.state.macros.with(index, { ...current, running }) })
	}

	/**
	 * An indicator's status or name, as its event says: applied where the module holds it, and read
	 * with the snapshot where the offer lists one the module has not read yet.
	 */
	private applyIndicatorEvent(event: IntegrationEventEnvelope, generation: number): void {
		const api = this.api

		if (!(api instanceof CrewLanV2Client)) {
			return
		}

		if (api.applyIndicatorEvent(event.wireId, event.payload)) {
			this.updateState({ indicators: api.indicators() })
		} else if (api.hasUnnamedIndicators()) {
			this.schedulePoll(generation, 0)
		}
	}

	/** Reads the controls or the groups again after their event; a failure waits for the next poll. */
	private async refreshIntercom(generation: number, part: 'controls' | 'groups'): Promise<void> {
		const api = this.api

		if (!(api instanceof CrewLanV2Client) || this.state.entityId === null || !this.state.connected) {
			return
		}

		// A connection whose offer holds no such read — one acting for a status indicator — reads nothing.
		if (!api.offers(part === 'controls' ? wireRequests.getControls : wireRequests.listGroups)) {
			return
		}

		const entityId = this.state.entityId
		const requestedAt = Date.now()

		try {
			if (part === 'controls') {
				const controls = await api.getEntityControls(entityId, this.requestOptions())

				// While the connection is down its controls stay cleared.
				if (generation === this.generation && this.state.connected) {
					this.applyControlsUpdate(controls, requestedAt)
				}

				return
			}

			await api.readGroups(this.requestOptions())

			if (generation === this.generation && this.state.connected) {
				this.groupsRefreshedAt = Date.now()
				this.updateState({ intercom: api.intercomState() })
			}
		} catch (error) {
			if (!isAbortError(error)) {
				this.log('debug', `Could not read the intercom ${part} again: ${describeError(error)}`)
			}
		}
	}

	/** Only reached once a snapshot has confirmed that this CrewLAN serves macros. */
	private applyMacroEvent(event: PublicEventEnvelope): void {
		if (event.type === 'macro.changed') {
			if (isPublicMacroDto(event.data)) {
				this.applyMacroUpdate(event.data, Date.now())
			} else {
				this.log('debug', 'Ignoring macro.changed event with an unexpected payload.')
			}

			return
		}

		if (isPublicMacroRemovedEventData(event.data)) {
			this.removeMacro(event.data.id)
		} else {
			this.log('debug', 'Ignoring macro.removed event with an unexpected payload.')
		}
	}

	/**
	 * Names come from the snapshot's participants, so a caller who joined after it shows by id: the
	 * snapshot is read again once per such id, and the intercom rebuilt with the name.
	 */
	private nameNewCallers(api: CrewLanV2Client): void {
		const unasked = api.unnamedCallers().filter((id) => !this.callerNamesAsked.has(id))

		if (unasked.length === 0) {
			return
		}

		for (const id of unasked) {
			this.callerNamesAsked.add(id)
		}

		const generation = this.generation

		void api.readParticipants(this.requestOptions()).then(
			() => {
				if (generation === this.generation && this.state.connected) {
					this.updateState({ intercom: api.intercomState() })
				}
			},
			(error: unknown) => {
				if (!isAbortError(error)) {
					this.log('debug', `Could not read the participants' names again: ${describeError(error)}`)
				}
			},
		)
	}

	private isOwnOffline(event: PublicEventEnvelope): boolean {
		return (
			event.type === 'status.changed' &&
			isPublicEntityStatusDto(event.data) &&
			event.data.entityId === this.state.entityId &&
			event.data.status.id === offlineStatusId
		)
	}

	/**
	 * The v2 stream holds its events back while the Entity is present at no Client, so every event
	 * frame on it, and a `gap`, says it is. A v1 stream speaks regardless and says nothing; a stream
	 * that says `attendance` says it directly, and its word alone counts.
	 */
	private notePresentByStream(): void {
		if (this.api instanceof CrewLanV2Client && this.attendance === null) {
			this.notePresent()
		}
	}

	/**
	 * A sign the Entity is present at a Client again — an accepted write, which CrewLAN refuses while
	 * it is absent: the buttons stop being held grey.
	 */
	private notePresent(): void {
		this.ownerAbsence = null

		if (this.attendance !== null) {
			this.attendance = { attends: true, at: Date.now() }
		}

		if (!this.state.ownerPresent && (this.attendance !== null || isEntityPresent(this.state.status))) {
			this.updateState({ ownerPresent: true })
		}
	}

	/**
	 * Whether `status` shows the Entity present, held false after a refusal until the status
	 * changed later than it: Status shows Offline only after its presence grace, so a status read
	 * between the refusal and that moment still shows the chosen one.
	 */
	private presenceFrom(status: PublicEntityStatusDto | null): boolean {
		// CrewLAN's own word, where it says one, is the measure; the status is a guess 15 s late.
		if (this.attendance !== null) {
			return this.attendance.attends
		}

		if (!isEntityPresent(status)) {
			return false
		}

		if (this.ownerAbsence === null) {
			return true
		}

		const changedAt = Date.parse(status?.updatedAt ?? '')

		if (Number.isFinite(changedAt) && changedAt > this.ownerAbsence.statusAt) {
			this.ownerAbsence = null
			return true
		}

		return false
	}

	/**
	 * Holds the buttons grey after an owner-absent refusal of a press sent at `sentAt`; see
	 * `ownerAbsence` and `attendance`.
	 */
	private noteAbsent(message: string, sentAt: number): void {
		const statusAt = Date.parse(this.state.status?.updatedAt ?? '')

		if (this.attendance !== null) {
			// The refusal says the target was absent when the press arrived, no later: CrewLAN's word
			// since then — the target attached again before the refusal came back — stands.
			if (sentAt < this.attendance.at) {
				this.updateState({ lastError: message })
				return
			}

			this.attendance = { attends: false, at: sentAt }
		}

		this.ownerAbsence = { statusAt: Number.isFinite(statusAt) ? statusAt : Number.NEGATIVE_INFINITY }
		this.updateState({ lastError: message, ownerPresent: false })
	}

	private applyStatusUpdate(
		status: PublicEntityStatusDto,
		requestedAt: number,
		extra: Partial<CrewLanState> = {},
	): void {
		if (status.entityId !== this.state.entityId) {
			if (Object.keys(extra).length > 0) {
				this.updateState(extra)
			}

			return
		}

		const next = pickFresher(this.state.status, status, requestedAt, this.lastLocalWriteAt)

		if (next === this.state.status && Object.keys(extra).length === 0) {
			return
		}

		this.updateState({
			...extra,
			status: next,
			ownerPresent: this.presenceFrom(next),
		})
	}

	private applyControlsUpdate(
		controls: PublicEntityControlsDto,
		requestedAt: number,
		extra: Partial<CrewLanState> = {},
	): void {
		if (controls.entityId !== this.state.entityId) {
			if (Object.keys(extra).length > 0) {
				this.updateState(extra)
			}

			return
		}

		const next = pickFresher(this.state.controls, controls, requestedAt, this.lastLocalWriteAt)

		if (next === controls) {
			this.controlsRefreshedAt = Date.now()
		}

		// The intercom follows the controls it was composed from, so an older answer moves neither.
		const intercom =
			this.api instanceof CrewLanV2Client && next === controls ? { intercom: this.api.intercomState() } : {}

		// An audio connection is a Client of the Entity attached: a sign of presence, where CrewLAN
		// does not say attendance itself — an audio connection can outlast the Client's channel.
		if (intercom.intercom?.audioConnected === true && this.attendance === null) {
			this.notePresent()
		}

		if (this.api instanceof CrewLanV2Client && next === controls) {
			this.nameNewCallers(this.api)
		}

		if (
			next === this.state.controls &&
			Object.keys(extra).length === 0 &&
			sameJson(intercom.intercom ?? this.state.intercom, this.state.intercom)
		) {
			// Nothing to publish: a poll that confirmed the state must not cost a variable update.
			return
		}

		this.updateState({ ...extra, ...intercom, controls: next })
	}

	/** Keep a macro the operator just started from being rolled back by an older in-flight poll. */
	private mergeMacros(incoming: PublicMacroDto[], requestedAt: number): PublicMacroDto[] {
		const current = new Map(this.state.macros.map((macro) => [macro.id, macro]))

		return incoming.map((macro) =>
			pickFresher(current.get(macro.id) ?? null, macro, requestedAt, this.lastLocalWriteAt),
		)
	}

	private applyMacroUpdate(macro: PublicMacroDto, requestedAt: number): void {
		const index = this.state.macros.findIndex((candidate) => candidate.id === macro.id)
		const current = index < 0 ? null : (this.state.macros[index] ?? null)
		const next = pickFresher(current, macro, requestedAt, this.lastLocalWriteAt)

		if (next === current) {
			return
		}

		const macros = index < 0 ? [...this.state.macros, next] : this.state.macros.with(index, next)
		this.updateState({ macros, macrosSupported: true })
	}

	private removeMacro(macroId: string): void {
		const macros = this.state.macros.filter((macro) => macro.id !== macroId)

		if (macros.length !== this.state.macros.length) {
			this.updateState({ macros })
		}
	}

	/**
	 * Record an alert that concerns this entity.
	 *
	 * A workspace alert carries no targets and reaches everyone. An entity alert without targets is
	 * not something CrewLAN sends, but if it ever did it is counted as ours on purpose: announcing an
	 * alert that was meant for somebody else is the harmless half of that mistake.
	 */
	private applyAlertEvent(occurredAt: string, scope: 'workspace' | 'entities', targetEntityIds: string[] | null): void {
		const entityId = this.state.entityId
		const targeted = targetEntityIds === null || (entityId !== null && targetEntityIds.includes(entityId))

		if (!targeted) {
			return
		}

		this.updateState({ lastAlert: describeAlert(occurredAt, scope) })
		this.armAlertExpiry()
	}

	/**
	 * Drop `last_alert` once it is older than the retention window. Without this the variable keeps
	 * showing an alert from hours ago, because CrewLAN only clears it when the operator dismisses.
	 */
	private armAlertExpiry(): void {
		this.clearAlertTimer()
		this.alertTimer = setTimeout(() => {
			this.alertTimer = null

			if (!this.destroyed && this.state.lastAlert.length > 0) {
				this.updateState({ lastAlert: '' })
			}
		}, alertRetentionMs)
	}

	private clearAlertTimer(): void {
		if (this.alertTimer !== null) {
			clearTimeout(this.alertTimer)
			this.alertTimer = null
		}
	}

	// ---------------------------------------------------------------------------
	// Writes
	// ---------------------------------------------------------------------------

	/** Controls as known now, re-read first if they are older than one poll interval. */
	private async currentControls(): Promise<PublicEntityControlsDto | null> {
		const stale = this.state.controls === null || Date.now() - this.controlsRefreshedAt > this.pollIntervalMs()

		if (!stale) {
			return this.state.controls
		}

		const api = this.requireApi()
		const entityId = this.requireEntityId()
		const generation = this.generation
		const requestedAt = Date.now()
		const controls = await api.getEntityControls(entityId, this.requestOptions())

		if (generation !== this.generation) {
			return controls
		}

		this.applyControlsUpdate(controls, requestedAt)
		return this.state.controls
	}

	private async patchControls(patch: ControlsPatch, options: RequestOptions = {}): Promise<void> {
		const api = this.requireApi()
		const entityId = this.requireEntityId()
		const generation = this.generation
		const controls = await api.patchEntityControls(entityId, patch, this.requestOptions(options))

		if (generation !== this.generation) {
			return
		}

		this.lastLocalWriteAt = Date.now()

		// A release is answered while the Entity is absent too, so only another write shows presence.
		if (patch.shoutbox.talk?.active !== false) {
			this.notePresent()
		}

		// One publish for the new controls and the cleared error: setVariableValues is batched.
		this.applyControlsUpdate(controls, this.lastLocalWriteAt, { lastError: '' })
	}

	private async enqueueTalkWrite(write: () => Promise<void>): Promise<void> {
		const run = this.talkQueue.then(write, write)
		this.talkQueue = run.catch(() => undefined)
		await run
	}

	private async enqueueListenWrite(write: () => Promise<void>): Promise<void> {
		const run = this.listenQueue.then(write, write)
		this.listenQueue = run.catch(() => undefined)
		await run
	}

	/**
	 * Closing the talk channel is the one write that must not fail quietly: a lost release leaves
	 * the microphone open while the button already looks idle. It is retried with a short deadline
	 * and a final failure is logged as an error instead of the generic warning.
	 */
	private async releaseTalk(label: string, release: (options: RequestOptions) => Promise<void>): Promise<void> {
		const generation = this.generation
		const signal = this.connectionAbort?.signal
		let lastError: unknown = null

		for (let attempt = 0; attempt < talkReleaseAttempts; attempt++) {
			if (attempt > 0) {
				await delay(talkReleaseRetryDelaysMs[attempt - 1] ?? 1000, signal)
			}

			// The connection was replaced or the module was destroyed while waiting: the device state
			// is no longer ours to manage, and Companion must not be called back after destroy().
			if (this.destroyed || generation !== this.generation) {
				return
			}

			try {
				await release({ timeoutMs: talkReleaseTimeoutMs })
				return
			} catch (error) {
				lastError = error

				// A release the offer no longer holds is refused here, before anything is sent: a retry
				// would only be refused again.
				if (isAbortError(error) || isRequestNotOfferedLocally(error)) {
					break
				}

				this.log(
					'warn',
					`Releasing ${label}: attempt ${String(attempt + 1)}/${String(talkReleaseAttempts)} failed: ${describeError(error)}`,
				)
			}
		}

		if (this.destroyed || generation !== this.generation) {
			return
		}

		const message = `Failed to release ${label} — the microphone may still be live in CrewLAN: ${describeError(lastError)}`
		this.log('error', message)

		if (isConnectionLevelError(lastError)) {
			this.handleConnectionError(lastError, message)
			this.scheduleReconnect(lastError)
			return
		}

		this.updateState({ lastError: message })
	}

	private requireApi(): CrewLanApiClient | CrewLanV2Client {
		if (this.api === null) {
			throw new CrewLanApiError('CrewLAN is not connected.')
		}

		return this.api
	}

	private requireEntityId(): string {
		if (!this.state.connected || this.state.entityId === null || this.state.entityId.length === 0) {
			throw new CrewLanApiError('CrewLAN entity capability is not connected.')
		}

		return this.state.entityId
	}

	// ---------------------------------------------------------------------------
	// Errors and status
	// ---------------------------------------------------------------------------

	private handleConnectionError(error: unknown, lastError?: string): void {
		const status = statusForError(error)
		const display = describeCompanionErrorForDisplay(error)
		const detail = describeError(error)

		// Stale controls/status must not keep asserting "talk live" while the box is unreachable.
		this.updateState({
			connected: false,
			streamConnected: false,
			status: null,
			controls: null,
			intercom: null,
			// The list survives so the buttons do not vanish, but nothing may keep claiming to run.
			macros: this.state.macros.map((macro) => (macro.running ? { ...macro, running: false } : macro)),
			lastError: lastError ?? display,
		})
		this.setInstanceStatus(status, display)
		// The connection list only shows the generic text; the real reason goes to the log.
		this.log('warn', display === detail ? display : `${display} Reason: ${detail}`)
	}

	/** An action's failure; `sentAt` is when it started, before anything was sent. */
	private handleOperationError(actionName: string, error: unknown, sentAt: number): void {
		let message = `${actionName}: ${describeError(error)}`

		// Over /api/v2 the owner's absence is named, and no revoked token: the connection stays up and
		// greys its buttons until a status or a snapshot shows the Entity present again.
		if (isOwnerAbsentError(error)) {
			this.log('warn', message)
			this.noteAbsent(message, sentAt)
			return
		}

		// v1 answers a write while the Entity is absent with a bare 401, and its reads go on, so the
		// connection stays up and greys its buttons as over v2; a refused token fails the next poll.
		// Over v2 a 401 of another code is a refused token, which the next poll reports.
		if (
			error instanceof CrewLanApiError &&
			error.statusCode === 401 &&
			this.state.connected &&
			this.state.api !== 'v2'
		) {
			message += ` (${ownerAbsentMessage})`
			this.log('warn', message)
			this.noteAbsent(message, sentAt)
			return
		}

		// A refused group or call write says why on the log alone: Companion shows nothing on a button
		// for a failed action.
		if (
			error instanceof CrewLanApiError &&
			(error.code === 'intercom_not_member' ||
				error.code === 'intercom_no_call' ||
				error.code === 'intercom_not_ringing')
		) {
			this.log('error', message)
			this.updateState({ lastError: message })
			return
		}

		this.log('warn', message)

		if (isConnectionLevelError(error)) {
			// One publish: handleConnectionError already writes the state, including this message.
			this.handleConnectionError(error, message)
			this.scheduleReconnect(error)
			return
		}

		this.updateState({ lastError: message })
	}

	private setInstanceStatus(status: InstanceStatus, message: string | null = null): void {
		if (this.instanceStatus === status && this.instanceStatusMessage === message) {
			return
		}

		this.instanceStatus = status
		this.instanceStatusMessage = message
		this.updateStatus(status, message)
	}

	// ---------------------------------------------------------------------------
	// State publishing
	// ---------------------------------------------------------------------------

	/**
	 * What the registered definitions depend on. Deliberately excludes the running flag, so starting
	 * a macro only re-checks feedbacks while a rename or a new macro re-registers the definitions.
	 */
	private definitionsKey(): string {
		return JSON.stringify({
			// Over v1 the Intercom presets hold the one Talk and Output; over v2 one set per group.
			api: this.state.api,
			// Over v2 the presets offered are those whose requests the offer holds.
			requests: this.state.requests,
			indicators: this.state.indicators.map((indicator) => [indicator.id, indicator.name, indicator.statusIds]),
			groups: (this.state.intercom?.groups ?? []).map((group) => [group.id, group.name]),
			statuses: this.getSelectableStatuses().map((status) => [
				status.id,
				getCompanionStatusLabel(status),
				status.colors.backgroundColor,
				status.colors.foregroundColor,
			]),
			macros: this.getRunnableMacros().map((macro) => [
				macro.id,
				macro.label,
				macro.colors.backgroundColor,
				macro.colors.foregroundColor,
			]),
		})
	}

	/**
	 * Apply a state patch, publish variables, and re-check only the feedbacks whose inputs changed.
	 * Definitions are re-registered only when the definitions key changed, which covers the id, label
	 * and colours of every selectable status and of every runnable macro.
	 */
	private updateState(patch: Partial<CrewLanState>): void {
		const previous = this.state
		const next: CrewLanState = { ...previous, ...patch }
		this.state = next

		UpdateVariableValues(this)

		const changed = new Set<StateGroup>()

		if (
			previous.connected !== next.connected ||
			previous.ownerPresent !== next.ownerPresent ||
			previous.api !== next.api ||
			!sameJson(previous.requests, next.requests)
		) {
			changed.add('connection')
		}

		if (!sameJson(previous.indicators, next.indicators)) {
			changed.add('indicators')
		}

		if (!sameJson(previous.intercom, next.intercom)) {
			changed.add('intercom')
		}

		if (!sameJson(previous.status, next.status) || !sameJson(previous.statuses, next.statuses)) {
			changed.add('status')
		}

		if (!sameJson(previous.controls, next.controls)) {
			changed.add('controls')
		}

		if (!sameJson(previous.macros, next.macros)) {
			changed.add('macros')
		}

		const [firstFeedbackId, ...otherFeedbackIds] = feedbackIdsForGroups(changed)

		if (firstFeedbackId !== undefined) {
			this.checkFeedbacks(firstFeedbackId, ...otherFeedbackIds)
		}

		if (this.definitionsKey() !== this.registeredDefinitionsKey) {
			this.updateDefinitions()
		}
	}
}

export default ModuleInstance
