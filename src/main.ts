import { InstanceBase, InstanceStatus, type InstanceTypes, type SomeCompanionConfigField } from '@companion-module/base'
import { CrewLanApiClient, CrewLanApiError, isAbortError, type ControlsPatch, type RequestOptions } from './api.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import {
	GetConfigFields,
	migrateLegacyEntityToken,
	resolveEntityToken,
	resolvePollIntervalMs,
	type ModuleConfig,
	type ModuleSecrets,
} from './config.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
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
/** CrewLAN writes a heartbeat comment every 15 s; three missed heartbeats mean the stream is dead. */
export const eventStreamIdleTimeoutMs = 45_000
export const reconnectBackoffBaseMs = 1000
export const reconnectBackoffMaxMs = 30_000
/** Retry cadence for failures that need a config change to recover (bad address, rejected token). */
export const nonRecoverableRetryDelayMs = 60_000
/**
 * Talk release retry budget. Companion aborts any action after 5 s, so the whole sequence
 * (3 × 1200 ms deadlines + 200 ms + 400 ms pauses = 4.2 s) must finish inside that window.
 */
/** How long `last_alert` keeps reporting an alert that was never dismissed. */
export const alertRetentionMs = 5 * 60 * 1000
export const talkReleaseAttempts = 3
export const talkReleaseTimeoutMs = 1200
const talkReleaseRetryDelaysMs = [200, 400]

export const authenticationFailedConnectionMessage = 'Could not establish a connection because authentication failed.'

type StateGroup = 'connection' | 'status' | 'controls' | 'macros'

/**
 * Which slice of the state each feedback reads. Typed as an exhaustive record so a feedback added
 * to FeedbacksSchema without an entry here fails to compile instead of silently never being
 * re-checked. Only the feedbacks of the groups that actually changed are re-checked.
 */
const feedbackStateGroups: Record<keyof FeedbacksSchema, StateGroup> = {
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
}

export function feedbackIdsForGroups(groups: ReadonlySet<StateGroup>): (keyof FeedbacksSchema)[] {
	return (Object.keys(feedbackStateGroups) as (keyof FeedbacksSchema)[]).filter((id) =>
		groups.has(feedbackStateGroups[id]),
	)
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

function sameJson(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b)
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
	private api: CrewLanApiClient | null = null
	private state: CrewLanState = createInitialState()

	/** Bumped on every (re)connect and cleanup; stale async work compares against it and bails. */
	private generation = 0
	private connectionAbort: AbortController | null = null
	private streamAbort: AbortController | null = null
	private pollTimer: NodeJS.Timeout | null = null
	private pollInFlight = false
	private reconnectTimer: NodeJS.Timeout | null = null
	private reconnectAttempt = 0
	private streamRestartTimer: NodeJS.Timeout | null = null
	private alertTimer: NodeJS.Timeout | null = null
	private streamRestartAttempt = 0
	/** Serialises talk writes so a quick press/release can never be applied out of order. */
	private talkQueue: Promise<void> = Promise.resolve()
	/** When the response of the last local write was applied (for ordering against polls). */
	private lastLocalWriteAt = 0
	/** When `state.controls` was last refreshed from the server. */
	private controlsRefreshedAt = 0
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

	/** Re-registers actions, feedbacks and presets; only needed when the selectable statuses change. */
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
		return this.state.macros
			.filter((macro) => macro.runnable)
			.sort(
				(a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
			)
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

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	/**
	 * Rebuild the connection. It deliberately does not await the reconnect: a full snapshot is six
	 * requests and Companion abandons an action after 5 s. Progress is reported through the
	 * instance status instead.
	 */
	refreshCrewLan(): void {
		this.log('info', 'Reconnecting to CrewLAN…')
		void this.connect()
	}

	async runCrewLanAction(actionName: string, action: () => Promise<void>): Promise<void> {
		try {
			await action()
		} catch (error) {
			if (isAbortError(error)) {
				this.log('debug', `${actionName}: cancelled because the connection was reset.`)
				return
			}

			this.handleOperationError(actionName, error)
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
		this.applyMacroUpdate(macro, this.lastLocalWriteAt)
		this.updateState({ lastError: '' })
	}

	async setListenMuteMode(mode: 'toggle' | 'on' | 'off'): Promise<void> {
		let nextMuted = mode === 'on'

		if (mode === 'toggle') {
			const controls = await this.currentControls()
			nextMuted = controls?.shoutbox.listen.muted !== true
		}

		await this.patchControls({ shoutbox: { listen: { muted: nextMuted } } })
	}

	async setTalkLatchMode(mode: 'toggle' | 'on' | 'off'): Promise<void> {
		let nextActive = mode === 'on'

		if (mode === 'toggle') {
			const controls = await this.currentControls()
			nextActive = controls?.shoutbox.talk.active !== true
		}

		await this.setTalkState(nextActive, 'latch')
	}

	async setTalkState(active: boolean, controlMode: 'push' | 'latch'): Promise<void> {
		await this.enqueueTalkWrite(async () => {
			if (active) {
				await this.patchControls({ shoutbox: { talk: { active: true, controlMode } } })
			} else {
				await this.releaseTalk(controlMode)
			}
		})
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
			this.api = new CrewLanApiClient({
				baseUrl: this.config.baseUrl,
				token: this.entityToken,
				logger: {
					debug: (message) => this.log('debug', message),
					warn: (message) => this.log('warn', message),
				},
			})
			await this.loadSnapshot(generation, abort.signal)
		} catch (error) {
			if (generation !== this.generation || isAbortError(error)) {
				return
			}

			this.api = null
			this.handleConnectionError(error)
			this.scheduleReconnect(error)
			return
		}

		if (generation !== this.generation) {
			return
		}

		this.reconnectAttempt = 0
		this.setInstanceStatus(InstanceStatus.Ok)
		this.startEventStream(generation)
		this.schedulePoll(generation)
	}

	private cleanupConnection(): void {
		this.generation++
		this.api = null
		this.pollInFlight = false
		this.clearReconnectTimer()
		this.clearPollTimer()
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
				onOpen: () => this.handleStreamOpen(generation),
				onEvent: (event) => {
					if (generation === this.generation) {
						this.applyEvent(event)
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
		this.streamRestartAttempt = 0
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
		if (this.pollInFlight || generation !== this.generation) {
			// An in-flight snapshot re-arms the timer itself when it settles.
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

		this.schedulePoll(generation)
	}

	// ---------------------------------------------------------------------------
	// Reconnect
	// ---------------------------------------------------------------------------

	private scheduleReconnect(error: unknown): void {
		// Nothing useful can happen on the dead connection until it is rebuilt.
		this.clearPollTimer()
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
				if (isPublicMacroDto(event.data)) {
					this.applyMacroUpdate(event.data, Date.now())
				} else {
					this.log('debug', 'Ignoring macro.changed event with an unexpected payload.')
				}

				return
			case 'macro.removed':
				if (isPublicMacroRemovedEventData(event.data)) {
					this.removeMacro(event.data.id)
				} else {
					this.log('debug', 'Ignoring macro.removed event with an unexpected payload.')
				}

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

		this.updateState({ ...extra, status: next })
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

		if (next === this.state.controls && Object.keys(extra).length === 0) {
			// Nothing to publish: a poll that confirmed the state must not cost a variable update.
			return
		}

		this.updateState({ ...extra, controls: next })
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
		// One publish for the new controls and the cleared error: setVariableValues is batched.
		this.applyControlsUpdate(controls, this.lastLocalWriteAt, { lastError: '' })
	}

	private async enqueueTalkWrite(write: () => Promise<void>): Promise<void> {
		const run = this.talkQueue.then(write, write)
		this.talkQueue = run.catch(() => undefined)
		await run
	}

	/**
	 * Closing the talk channel is the one write that must not fail quietly: a lost release leaves
	 * the microphone open while the button already looks idle. It is retried with a short deadline
	 * and a final failure is logged as an error instead of the generic warning.
	 */
	private async releaseTalk(controlMode: 'push' | 'latch'): Promise<void> {
		const patch: ControlsPatch = { shoutbox: { talk: { active: false, controlMode: null } } }
		const generation = this.generation
		const signal = this.connectionAbort?.signal
		let lastError: unknown = null

		for (let attempt = 0; attempt < talkReleaseAttempts; attempt++) {
			if (attempt > 0) {
				await delay(talkReleaseRetryDelaysMs[attempt - 1] ?? 400, signal)
			}

			// The connection was replaced or the module was destroyed while waiting: the device state
			// is no longer ours to manage, and Companion must not be called back after destroy().
			if (this.destroyed || generation !== this.generation) {
				return
			}

			try {
				await this.patchControls(patch, { timeoutMs: talkReleaseTimeoutMs })
				return
			} catch (error) {
				lastError = error

				if (isAbortError(error)) {
					break
				}

				this.log(
					'warn',
					`Talk release (${controlMode}) attempt ${String(attempt + 1)}/${String(talkReleaseAttempts)} failed: ${describeError(error)}`,
				)
			}
		}

		if (this.destroyed || generation !== this.generation) {
			return
		}

		const message = `Failed to release talk (${controlMode}) — the microphone may still be live in CrewLAN: ${describeError(lastError)}`
		this.log('error', message)

		if (isConnectionLevelError(lastError)) {
			this.handleConnectionError(lastError, message)
			this.scheduleReconnect(lastError)
			return
		}

		this.updateState({ lastError: message })
	}

	private requireApi(): CrewLanApiClient {
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
			// The list survives so the buttons do not vanish, but nothing may keep claiming to run.
			macros: this.state.macros.map((macro) => (macro.running ? { ...macro, running: false } : macro)),
			lastError: lastError ?? display,
		})
		this.setInstanceStatus(status, display)
		// The connection list only shows the generic text; the real reason goes to the log.
		this.log('warn', display === detail ? display : `${display} Reason: ${detail}`)
	}

	private handleOperationError(actionName: string, error: unknown): void {
		let message = `${actionName}: ${describeError(error)}`

		if (error instanceof CrewLanApiError && error.statusCode === 401 && this.state.connected) {
			message += ' (CrewLAN rejects actions while the entity is not present.)'
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
	 * Definitions are re-registered only when the selectable status list changed.
	 */
	private updateState(patch: Partial<CrewLanState>): void {
		const previous = this.state
		const next: CrewLanState = { ...previous, ...patch }
		this.state = next

		UpdateVariableValues(this)

		const changed = new Set<StateGroup>()

		if (previous.connected !== next.connected) {
			changed.add('connection')
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
