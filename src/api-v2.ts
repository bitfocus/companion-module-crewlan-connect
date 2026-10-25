import {
	CrewLanApiClient,
	CrewLanApiError,
	describeCause,
	truncate,
	type ControlsPatch,
	type CrewLanApiLogger,
	type RequestOptions,
	type SetEntityStatusResult,
	type StreamEventsOptions,
} from './api.js'
import {
	isAnything,
	isIntegrationDescription,
	isIntegrationEntityStatusView,
	isIntegrationEventEnvelope,
	isIntegrationGroupList,
	isIntegrationGroupView,
	isIntegrationIntercomControls,
	isIntegrationMacroView,
	isIntegrationSnapshot,
	isItemResponse,
	type Guard,
} from './guards.js'
import type {
	IntegrationDescription,
	IntegrationEntityStatusView,
	IntegrationEventEnvelope,
	IntegrationGroupView,
	IntegrationIntercomControls,
	IntegrationMacroView,
	IntegrationStatusView,
	IntercomState,
	PublicDismissEntityAlertsDto,
	PublicEntityControlsDto,
	PublicEntityDto,
	PublicEntityStatusDto,
	PublicEventEnvelope,
	PublicMacroDto,
	PublicStatusDto,
	PublicWorkspaceDto,
} from './types.js'

/**
 * The CrewLAN integration API `/api/v2` client (crewlan-v2 `docs/architecture.md` `### The
 * integration API`).
 *
 * It speaks through a `CrewLanApiClient`, so deadlines, error classification and the event-stream
 * transport are the v1 path's own, and it answers in the Public API v1 DTOs the rest of the module
 * reads: v2's built-in status words become v1's `sys-…` ids, colours get the foreground the Core's
 * own v1 translation computes (`crewlan-transport-http` `src/compat/`), and the intercom controls
 * become v1's one Global Talk and Output mute beside the `IntercomState` only v2 has.
 */

/** Every event the module reads on `/api/v2/events`; one the Workspace does not know is ignored there. */
export const integrationEventTypes = [
	'status.event.entityStatusChanged',
	'status.event.statusDefined',
	'status.event.statusUpdated',
	'status.event.statusRemoved',
	'alerts.event.alertRaised',
	'macros.event.macroCreated',
	'macros.event.macroUpdated',
	'macros.event.macroRemoved',
	'macros.event.macroRunStarted',
	'macros.event.macroRunEnded',
	'intercom.event.controlsChanged',
	'intercom.event.groupCreated',
	'intercom.event.groupChanged',
	'intercom.event.groupRemoved',
	'intercom.event.memberAdded',
	'intercom.event.memberRemoved',
] as const

/** v2's built-in status words and the v1 ids users' buttons keep, as the Core's v1 translation names them. */
const v1StatusIds: Readonly<Record<string, string>> = {
	ready: 'sys-green',
	attention: 'sys-yellow',
	critical: 'sys-red',
	standby: 'sys-idle',
	offline: 'sys-offline',
}

/** The English name of each built-in status, which v2 does not send (`BuiltInStatus::english`). */
const builtInLabels: Readonly<Record<string, string>> = {
	ready: 'OK',
	attention: 'Attention',
	critical: 'Critical',
	standby: 'Standby',
	offline: 'Offline',
}

/** The v1 id of the offline system status: what everybody sees of an Entity nobody is present as. */
export const offlineStatusId = 'sys-offline'

/** A v2 status id as the module keeps it: a built-in word as its `sys-…` id, a custom id unchanged. */
export function toV1StatusId(id: string): string {
	return v1StatusIds[id] ?? id
}

/** The module's status id as v2 reads it: a `sys-…` id as its built-in word, a custom id unchanged. */
export function toV2StatusId(id: string): string {
	return Object.entries(v1StatusIds).find(([, legacy]) => legacy === id)?.[0] ?? id
}

/** How far a dimmed button darkens its colour: the foreground must read on both (`compat/status.rs`). */
const dimmedFactor = 0.32

function luminance(rgb: readonly number[]): number {
	const linear = (channel: number): number =>
		channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

	return 0.2126 * linear(rgb[0] ?? 0) + 0.7152 * linear(rgb[1] ?? 0) + 0.0722 * linear(rgb[2] ?? 0)
}

function contrast(first: number, second: number): number {
	const [lighter, darker] = first > second ? [first, second] : [second, first]

	return (lighter + 0.05) / (darker + 0.05)
}

/** Black or white, whichever reads better on the colour lit and dimmed, as v1's `foregroundColor`. */
export function foregroundFor(background: string): '#000000' | '#ffffff' {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(background)

	if (match === null) {
		return '#ffffff'
	}

	const rgb = match.slice(1).map((part) => Number.parseInt(part, 16) / 255)
	const dimmed = rgb.map((channel) => channel * dimmedFactor)
	const worst = (foreground: number): number =>
		Math.min(contrast(foreground, luminance(rgb)), contrast(foreground, luminance(dimmed)))

	return worst(0) > worst(1) ? '#000000' : '#ffffff'
}

function colorsOf(color: string): PublicStatusDto['colors'] {
	const backgroundColor = color.toLowerCase()

	return { backgroundColor, foregroundColor: foregroundFor(backgroundColor) }
}

export function toPublicStatus(view: IntegrationStatusView): PublicStatusDto {
	return {
		id: view.builtIn ? toV1StatusId(view.id) : view.id,
		kind: view.builtIn ? 'system' : 'custom',
		label: view.builtIn ? (builtInLabels[view.id] ?? view.id) : (view.label ?? ''),
		colors: colorsOf(view.color),
		...(view.animation === undefined ? {} : { motionPreset: view.animation }),
		selectable: view.selectable,
	}
}

/** One Entity's status in v1's shape, or null where its status is not in `statuses`. */
export function toPublicEntityStatus(
	view: IntegrationEntityStatusView,
	statuses: readonly PublicStatusDto[],
): PublicEntityStatusDto | null {
	const status = statuses.find((candidate) => candidate.id === toV1StatusId(view.statusId))

	return status === undefined
		? null
		: {
				entityId: view.entityId,
				status,
				selectedStatusId: toV1StatusId(view.chosenStatusId),
				updatedAt: view.changedAt ?? null,
			}
}

export function toPublicMacro(view: IntegrationMacroView, runnable: boolean): PublicMacroDto {
	return {
		id: view.id,
		label: view.name,
		colors: colorsOf(view.color),
		running: view.running,
		runnable: view.runnable ?? runnable,
		runStartedAt: view.runStartedAt ?? null,
		updatedAt: view.updatedAt ?? null,
	}
}

/** v2's controls as v1's: Output is v1's listen mute, Global Talk v1's one talk control. */
export function toPublicControls(entityId: string, controls: IntegrationIntercomControls): PublicEntityControlsDto {
	return {
		entityId,
		shoutbox: {
			listen: { enabled: true, muted: controls.outputMuted, available: true },
			talk: {
				enabled: true,
				active: controls.globalTalk.held,
				live: controls.audio.sending,
				controlMode: controls.globalTalk.held ? controls.globalTalk.talkKey : null,
				// The Core lets no talk key be held in a direct call (`compat/read.rs` `v1_controls`).
				available: controls.audio.connected && controls.call === null,
			},
		},
		updatedAt: controls.changedAt ?? null,
	}
}

/** The groups the Entity is a member of, the Everyone group first, with its listening and talking of each. */
export function toIntercomState(
	entityId: string,
	groups: readonly IntegrationGroupView[],
	controls: IntegrationIntercomControls,
	participants: ReadonlyMap<string, string>,
): IntercomState {
	const caller = (id: string): { id: string; name: string } => ({ id, name: participants.get(id) ?? id })
	const member = groups.filter((group) => group.everyone || group.members.includes(entityId))

	return {
		groups: [...member.filter((group) => group.everyone), ...member.filter((group) => !group.everyone)].map((group) => {
			const talk = controls.groupTalk.find((entry) => entry.groupId === group.id)

			return {
				id: group.id,
				name: group.everyone ? 'All' : (group.name ?? group.id),
				everyone: group.everyone,
				muted: group.listening?.muted ?? false,
				gainDb: group.listening?.gainDb ?? 0,
				talkHeld: talk !== undefined,
				talkKey: talk?.talkKey ?? null,
			}
		}),
		inputMuted: controls.inputMuted,
		audioConnected: controls.audio.connected,
		ringing: controls.ringing.map((ring) => caller(ring.callerId)),
		call: controls.call === null ? null : caller(controls.call.callerId),
	}
}

/**
 * What `event: ended` means for the connection: a token no connection has or a paused one's is a
 * refused authentication, a blocked address or a v1 switched off a forbidden one, as their HTTP
 * answers are; any other code ends this stream alone, which the module opens again.
 */
export function endedError(code: string): CrewLanApiError {
	const message = `CrewLAN ended the event stream (${code}).`

	if (code === 'connection_unknown' || code === 'connection_paused') {
		return new CrewLanApiError(message, 401, 'http', code)
	}

	if (code === 'address_blocked' || code === 'compatibility_mode_off') {
		return new CrewLanApiError(message, 403, 'http', code)
	}

	return new CrewLanApiError(message, null, 'network', code)
}

/**
 * `GET /api/v2`: the description where the Workspace serves the integration API. Null — the
 * Public API v1 path, which then classifies the connection — on a `404` (a Workspace speaking v1
 * only, or a run whose edition offers neither), or on a success whose body is no v2 description
 * (an HTML page or another JSON body). Every other answer fails the connection as every request
 * does: a refusal such as `connection_unknown`, `connection_paused`, `address_blocked` or a `429`
 * (retried on the reconnect backoff), and no answer at all.
 */
export async function probeIntegrationApi(
	http: CrewLanApiClient,
	options: RequestOptions = {},
): Promise<IntegrationDescription | null> {
	try {
		return (await http.request('/api/v2', {}, options, isItemResponse(isIntegrationDescription))).data
	} catch (error) {
		// A refusal on the probe is the connection's own: read as v1, a v1 compatibility mode
		// switched off would answer it with its own sentence, and a 429 would pin v1 for good.
		if (
			error instanceof CrewLanApiError &&
			(error.kind === 'invalid-response' || (error.kind === 'http' && error.statusCode === 404))
		) {
			return null
		}

		throw error
	}
}

/** Everything one snapshot gives the module, in v1's shapes, plus the intercom only v2 has. */
export interface IntegrationState {
	entityId: string
	workspace: PublicWorkspaceDto
	entity: PublicEntityDto
	statuses: PublicStatusDto[]
	status: PublicEntityStatusDto | null
	controls: PublicEntityControlsDto
	macros: PublicMacroDto[]
	intercom: IntercomState
}

/** A body of `intercom.command.setControls`, the fields the module sends. */
export interface IntegrationControlsBody {
	inputMuted?: boolean
	outputMuted?: boolean
	globalTalk?: boolean
	talkKey?: 'push' | 'latch'
	groupTalk?: { groupId: string; held: boolean; talkKey?: 'push' | 'latch' }
	call?: { callerId: string } | null
}

function isAcknowledged(value: unknown): value is { acknowledged: unknown[] } {
	return (
		typeof value === 'object' && value !== null && Array.isArray((value as { acknowledged?: unknown }).acknowledged)
	)
}

/**
 * The `/api/v2` client of one connection. It keeps what translating needs between requests — the
 * status catalogue, the participants' names, the last controls and groups — each replaced by the
 * next snapshot.
 */
export class CrewLanV2Client {
	readonly baseUrl: string
	private statuses: PublicStatusDto[] = []
	private participants = new Map<string, string>()
	private controls: IntegrationIntercomControls | null = null
	private groups: IntegrationGroupView[] | null = null
	private entityId: string | null = null

	constructor(
		private readonly http: CrewLanApiClient,
		private readonly description: IntegrationDescription,
		private readonly logger: CrewLanApiLogger,
	) {
		this.baseUrl = http.baseUrl
	}

	/** Whether this connection may run macros, as `GET /api/v2` offered it. */
	get mayRunMacros(): boolean {
		return this.description.requests.some((request) => request.wireId === 'macros.command.runMacro')
	}

	/** The snapshot, the controls and the groups, read at once: what a connect and a resync need. */
	async loadSnapshot(options: RequestOptions = {}): Promise<IntegrationState> {
		const [snapshot, controls, groups] = await Promise.all([
			this.http.request('/api/v2/snapshot', {}, options, isItemResponse(isIntegrationSnapshot)),
			this.ask('intercom.query.getControls', {}, isIntegrationIntercomControls, options),
			this.ask('intercom.query.listGroups', {}, isIntegrationGroupList, options),
		])
		const { workspace, entity, participants, statuses, macros } = snapshot.data
		const entityId = entity.id
		this.entityId = entityId
		this.statuses = statuses.statuses.map(toPublicStatus)
		this.participants = new Map(participants.map((participant) => [participant.id, participant.displayIdentity]))
		this.controls = controls
		this.groups = groups.groups
		const standing = statuses.entities.find((candidate) => candidate.entityId === entityId)

		return {
			entityId,
			workspace: { id: workspace.id, name: workspace.name },
			entity: { id: entityId, displayName: entity.displayIdentity, position: null },
			statuses: this.statuses,
			status: standing === undefined ? null : toPublicEntityStatus(standing, this.statuses),
			controls: toPublicControls(entityId, controls),
			macros: macros.map((macro) => toPublicMacro(macro, this.mayRunMacros)),
			intercom: toIntercomState(entityId, groups.groups, controls, this.participants),
		}
	}

	/** The ids who ring or are in the call by the last controls read whose names the snapshot did not hold. */
	unnamedCallers(): string[] {
		const ids = [...(this.controls?.ringing ?? []), ...(this.controls?.call ? [this.controls.call] : [])].map(
			(caller) => caller.callerId,
		)

		return ids.filter((id) => !this.participants.has(id))
	}

	/** Reads the snapshot again for the participants' names alone: a participant created after it. */
	async readParticipants(options: RequestOptions = {}): Promise<void> {
		const snapshot = await this.http.request('/api/v2/snapshot', {}, options, isItemResponse(isIntegrationSnapshot))

		this.participants = new Map(
			snapshot.data.participants.map((participant) => [participant.id, participant.displayIdentity]),
		)
	}

	/** The intercom as the last controls and groups read say, or null before the first snapshot. */
	intercomState(): IntercomState | null {
		if (this.entityId === null || this.controls === null || this.groups === null) {
			return null
		}

		return toIntercomState(this.entityId, this.groups, this.controls, this.participants)
	}

	async getEntityControls(entityId: string, options: RequestOptions = {}): Promise<PublicEntityControlsDto> {
		this.controls = await this.ask('intercom.query.getControls', {}, isIntegrationIntercomControls, options)

		return toPublicControls(entityId, this.controls)
	}

	/** v1's controls patch as `intercom.command.setControls`: Output and Global Talk. */
	async patchEntityControls(
		entityId: string,
		patch: ControlsPatch,
		options: RequestOptions = {},
	): Promise<PublicEntityControlsDto> {
		const body: IntegrationControlsBody = {}
		const { listen, talk } = patch.shoutbox

		if (listen?.muted !== undefined) {
			body.outputMuted = listen.muted
		}

		if (talk?.active !== undefined) {
			body.globalTalk = talk.active

			if (talk.active && talk.controlMode !== undefined && talk.controlMode !== null) {
				body.talkKey = talk.controlMode
			}
		}

		return this.setControls(entityId, body, options)
	}

	/** `intercom.command.setControls`, answered with the controls as they are after the act. */
	async setControls(
		entityId: string,
		body: IntegrationControlsBody,
		options: RequestOptions = {},
	): Promise<PublicEntityControlsDto> {
		this.controls = await this.ask('intercom.command.setControls', body, isIntegrationIntercomControls, options)

		return toPublicControls(entityId, this.controls)
	}

	/** Mutes or unmutes one group, `muted` alone so the level stays, then reads the groups again. */
	async setListening(groupId: string, muted: boolean, options: RequestOptions = {}): Promise<void> {
		const answer = await this.ask('intercom.command.setListening', { groupId, muted }, isAnything, options)

		if (isIntegrationGroupList(answer)) {
			this.groups = answer.groups
			return
		}

		const group = typeof answer === 'object' && answer !== null ? (answer as { group?: unknown }).group : undefined

		if (isIntegrationGroupView(group) && this.groups !== null) {
			this.groups = this.groups.map((candidate) => (candidate.id === group.id ? group : candidate))
			return
		}

		await this.readGroups(options)
	}

	async readGroups(options: RequestOptions = {}): Promise<void> {
		this.groups = (await this.ask('intercom.query.listGroups', {}, isIntegrationGroupList, options)).groups
	}

	async setEntityStatus(
		entityId: string,
		statusId: string,
		options: RequestOptions = {},
	): Promise<SetEntityStatusResult> {
		const view = await this.ask(
			'status.command.setEntityStatus',
			{ entityId, statusId: toV2StatusId(statusId) },
			isIntegrationEntityStatusView,
			options,
		)

		return { selectedStatusId: toV1StatusId(view.chosenStatusId), status: toPublicEntityStatus(view, this.statuses) }
	}

	async runMacro(macroId: string, options: RequestOptions = {}): Promise<PublicMacroDto> {
		return toPublicMacro(
			await this.ask('macros.command.runMacro', { macroId }, isIntegrationMacroView, options),
			this.mayRunMacros,
		)
	}

	/** Acknowledges every open alert of the Entity's, as v1's dismiss did. */
	async dismissEntityAlerts(entityId: string, options: RequestOptions = {}): Promise<PublicDismissEntityAlertsDto> {
		const answer = await this.ask('alerts.command.acknowledgeAlerts', { allOpen: true }, isAcknowledged, options)

		return { entityId, dismissedCount: answer.acknowledged.length }
	}

	/**
	 * The event stream. An event v1 has a shape for reaches `onEvent` in that shape; every other one
	 * `onIntegrationEvent`; `event: gap` calls `onGap`; `event: ended` ends the stream with
	 * `endedError` of its code.
	 */
	async streamEvents(options: StreamEventsOptions): Promise<void> {
		await this.http.openEventStream(`/api/v2/events?types=${integrationEventTypes.join(',')}`, options, (frames) => {
			for (const frame of frames) {
				if (frame.event === 'ended') {
					throw endedError(endedCode(frame.data))
				}

				if (frame.event === 'gap') {
					options.onGap?.()
					continue
				}

				this.dispatch(frame.data, options)
			}
		})
	}

	/** One event in v1's shape where v1 has one for it, null otherwise. */
	translateEvent(event: IntegrationEventEnvelope): PublicEventEnvelope | null {
		const { payload, occurredAt } = event

		switch (event.wireId) {
			case 'status.event.entityStatusChanged': {
				const status = isIntegrationEntityStatusView(payload) ? toPublicEntityStatus(payload, this.statuses) : null

				return status === null ? null : { type: 'status.changed', occurredAt, data: status }
			}
			case 'alerts.event.alertRaised':
				return {
					type: 'alert.triggered',
					occurredAt,
					data: {
						scope: 'entities',
						targetEntityIds: typeof payload.entityId === 'string' ? [payload.entityId] : null,
					},
				}
			case 'macros.event.macroCreated':
			case 'macros.event.macroUpdated':
				return isIntegrationMacroView(payload.macro)
					? { type: 'macro.changed', occurredAt, data: toPublicMacro(payload.macro, this.mayRunMacros) }
					: null
			case 'macros.event.macroRemoved':
				return typeof payload.macroId === 'string'
					? { type: 'macro.removed', occurredAt, data: { id: payload.macroId } }
					: null
			default:
				return null
		}
	}

	private dispatch(data: string, options: StreamEventsOptions): void {
		let parsed: unknown

		try {
			parsed = JSON.parse(data)
		} catch {
			this.logger.debug(`Ignoring malformed CrewLAN event frame: ${truncate(data)}`)
			return
		}

		if (!isIntegrationEventEnvelope(parsed)) {
			this.logger.debug(`Ignoring unexpected CrewLAN event frame: ${truncate(data)}`)
			return
		}

		try {
			const translated = this.translateEvent(parsed)

			if (translated === null) {
				options.onIntegrationEvent?.(parsed)
			} else {
				options.onEvent(translated)
			}
		} catch (error) {
			// One bad frame must not take the whole stream down, as on v1.
			this.logger.warn(`Failed to apply CrewLAN event "${parsed.wireId}": ${describeCause(error)}`)
		}
	}

	private async ask<T>(wireId: string, body: object, guard: Guard<T>, options: RequestOptions): Promise<T> {
		return (
			await this.http.request(
				`/api/v2/requests/${encodeURIComponent(wireId)}`,
				{ method: 'POST', body: JSON.stringify(body) },
				options,
				isItemResponse(guard),
			)
		).data
	}
}

function endedCode(data: string): string {
	try {
		const parsed: unknown = JSON.parse(data)

		if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { code?: unknown }).code === 'string') {
			return (parsed as { code: string }).code
		}
	} catch {
		// An unreadable `ended` still ends the stream.
	}

	return 'unknown'
}
