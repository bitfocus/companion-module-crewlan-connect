/**
 * The CrewLAN Public API v1 wire types.
 *
 * Two rules keep this file honest against `guards.ts`:
 *
 * 1. A field no guard checks is declared optional, so the compiler forces every reader to handle
 *    its absence rather than trusting a promise the module never verified. A required field here
 *    is therefore also a field that is validated at the API boundary.
 * 2. Types that exist only to document the wire format carry a `Documentation only` note. Nothing
 *    in the module reads them, so rule 1 does not apply to their fields.
 */

export interface PublicResponseMeta {
	apiVersion: 'v1'
	revision: number
	nextCursor?: number | null
}

/** Documentation only: `isItemResponse()` narrows the `{ data }` wrapper it needs directly. */
export interface PublicItemResponse<T> {
	data: T
	meta: PublicResponseMeta
}

/** Documentation only: list endpoints reach the module through `isItemResponse()` as well. */
export interface PublicListResponse<T> {
	data: T[]
	meta: PublicResponseMeta
}

export interface PublicSessionDto {
	workspace: {
		/** Not validated; the module decides on the entity grants alone. */
		required?: boolean
		granted: boolean
	}
	entities: Array<{
		entityId: string
		granted: boolean
	}>
}

export interface PublicWorkspaceDto {
	id: string | null
	name: string
	/** Not validated and unread; CrewLAN's listen mode does not change what Companion may do. */
	listenMode?: 'local-only' | 'lan'
	/** Not validated and unread: the token, not this flag, decides what the module may do. */
	protected?: boolean
	/** Not validated and unread; macro support is decided by the macro endpoint's own answer. */
	features?: string[]
}

export interface PublicStatusDto {
	id: string
	kind: 'system' | 'custom'
	label: string
	/** Not validated and unread: the module paints buttons from `colors`, not from the palette key. */
	paletteKey?: string
	colors: {
		backgroundColor: string
		foregroundColor: string
	}
	/** Not validated and unread; alerts reach the module as their own event. */
	alertType?: string | null
	/**
	 * Not validated, because a status that is otherwise complete must still be usable: the
	 * `current_status_motion` variable is then empty.
	 */
	motionPreset?: string
	selectable: boolean
}

export interface PublicEntityDto {
	id: string
	/** Not validated and unread; a participant and a device are controlled the same way. */
	type?: 'participant' | 'device'
	displayName: string
	/** May be absent; the `entity_position` variable is then empty. */
	position?: string | null
	/** Not validated and unread: CrewLAN, not Companion, enforces the entity's credential. */
	credentialRequired?: boolean
	/** Not validated and unread; liveness is decided by the event stream and the poll. */
	lastSeenAt?: string
	/** Not validated; the current status is read from the entity status endpoint instead. */
	status?: PublicStatusDto
}

export interface PublicEntityStatusDto {
	entityId: string
	status: PublicStatusDto
	selectedStatusId: string
	/** May be absent; the freshness rules then fall back to request ordering. */
	updatedAt?: string | null
}

export interface PublicEntityControlsDto {
	entityId: string
	shoutbox: {
		listen: {
			enabled: boolean
			muted: boolean
			available: boolean
		}
		talk: {
			enabled: boolean
			active: boolean
			live: boolean
			controlMode: 'push' | 'latch' | null
			/** Not validated and unread; CrewLAN, not Companion, remembers the operator's latch choice. */
			latchedPreference?: boolean
			available: boolean
		}
	}
	/** May be absent; the freshness rules then fall back to request ordering. */
	updatedAt?: string | null
}

export interface PublicDismissEntityAlertsDto {
	/** Not validated: a 2xx answer is the acknowledgement, this field only restates it. */
	status?: 'updated'
	entityId: string
	dismissedCount: number
}

export type PublicEventType =
	'status.changed' | 'alert.triggered' | 'entity.controls.changed' | 'macro.changed' | 'macro.removed'

/**
 * A CrewLAN macro as the Public API publishes it.
 *
 * A macro is one-shot: Companion can start it, and the only state it reports back is whether a run
 * is currently in progress.
 */
export interface PublicMacroDto {
	id: string
	label: string
	colors: {
		backgroundColor: string
		foregroundColor: string
	}
	/** True while a run of this macro is in progress. */
	running: boolean
	/** The analogue of PublicStatusDto.selectable: false hides the macro from Companion. */
	runnable: boolean
	/** Sort key; ties break on label, then id. A macro without one sorts after all that have one. */
	sortOrder?: number
	runStartedAt?: string | null
	/** May be absent; the freshness rules then fall back to request ordering. */
	updatedAt?: string | null
}

export interface PublicMacroRemovedEventData {
	id: string
}

/** Documentation only: the entity an event carries alongside its payload. */
export interface PublicEntitySummaryDto {
	id: string
	type: 'participant' | 'device'
	displayName: string
	position: string | null
}

/**
 * Documentation only. `status.changed` is narrowed with `isPublicEntityStatusDto`, which this type
 * extends: the module reads the status and takes the entity it is bound to from its own state.
 */
export interface PublicStatusChangedEventData extends PublicEntityStatusDto {
	entity: PublicEntitySummaryDto
}

export interface PublicAlertTriggeredEventData {
	scope: 'workspace' | 'entities'
	targetEntityIds: string[] | null
}

/** Documentation only, for the same reason, narrowed with `isPublicEntityControlsDto`. */
export interface PublicEntityControlsChangedEventData extends PublicEntityControlsDto {
	entity: PublicEntitySummaryDto
}

export interface PublicEventEnvelope<TData = unknown> {
	/** Not validated and unread: the module holds no cursor and never replays an event. */
	id?: string
	type: PublicEventType
	occurredAt: string
	data: TData
	/** Not validated and unread, for the same reason. */
	meta?: PublicResponseMeta
}

export interface CrewLanState {
	/** The REST snapshot succeeded and the bound entity is known. */
	connected: boolean
	/** The live event stream is currently open. */
	streamConnected: boolean
	entityId: string | null
	workspace: PublicWorkspaceDto | null
	entity: PublicEntityDto | null
	statuses: PublicStatusDto[]
	macros: PublicMacroDto[]
	/** False when the connected CrewLAN has no macro support, so no macro buttons are offered. */
	macrosSupported: boolean
	status: PublicEntityStatusDto | null
	controls: PublicEntityControlsDto | null
	lastAlert: string
	lastError: string
	/** Which API this connection speaks, decided at every connect by `GET /api/v2`; null before. */
	api: CrewLanApiVersion | null
	/**
	 * False from a write CrewLAN refused because no Client of the bound Entity is attached, or from a
	 * status showing it Offline — which CrewLAN shows only after a 15 s presence grace — until a sign
	 * of presence: an accepted write, an event on the v2 stream, an audio connection, or a status
	 * changed after the refusal. Every preset's button greys while it is false, as while `connected` is.
	 */
	ownerPresent: boolean
	/** What `/api/v2` says of the intercom beyond the one talk and mute; null over v1 or before the first read. */
	intercom: IntercomState | null
}

/** Which CrewLAN API a connection speaks: the integration API `/api/v2`, or the Public API v1. */
export type CrewLanApiVersion = 'v1' | 'v2'

/** One intercom group the bound participant is a member of, as the module shows it (v2 only). */
export interface IntercomGroupState {
	/** `everyone`, or `grp-…`. */
	id: string
	/** The shown name: "All" for the Everyone group, as the Client names it; the group's own name otherwise. */
	name: string
	everyone: boolean
	/** The participant's own listening of the group: muted, and the level a mute keeps. */
	muted: boolean
	gainDb: number
	/** Whether the participant's talk key for the group is held on now. */
	talkHeld: boolean
	/** How it is held while `talkHeld`: `push` or `latch`; null while it is not held. */
	talkKey: 'push' | 'latch' | null
}

/** A participant a direct call names, with the name CrewLAN shows for them. */
export interface IntercomCaller {
	id: string
	name: string
}

/** The participant's intercom over `/api/v2`, beyond v1's Global Talk and Output mute. */
export interface IntercomState {
	/** The groups the participant is a member of, the Everyone group first. */
	groups: IntercomGroupState[]
	/** The participant's input mute: their Client sends nothing while it is set. */
	inputMuted: boolean
	/** Whether the participant holds an audio connection now. */
	audioConnected: boolean
	/** Who rings the participant, the first caller first: *Answer* answers the first. */
	ringing: IntercomCaller[]
	/** The current direct call, or null. */
	call: IntercomCaller | null
}

/** A dropdown entry, used for both status and macro pickers. */
export interface CrewLanChoice {
	id: string
	label: string
}

/*
 * The integration API `/api/v2` wire types (crewlan-v2 `docs/architecture.md` `### The integration
 * API`). The module translates them into the Public API v1 DTOs above at the API boundary
 * (`api-v2.ts`), so every action, feedback, variable and preset reads one state over both APIs.
 * The same two rules hold: a field `guards.ts` does not check is optional here.
 */

/** `GET /api/v2`: what this connection may ask and which events its stream may carry. */
export interface IntegrationDescription {
	api: 'v2'
	requests: Array<{ wireId: string; kind?: string }>
	/** Not validated and unread: the module subscribes by name, and an unknown one is ignored. */
	events?: string[]
}

/** One status of `status.query.listStatuses`: a built-in status's word, or a custom status's id. */
export interface IntegrationStatusView {
	id: string
	builtIn: boolean
	/** Null for a built-in status, whose English name the module supplies. */
	label: string | null
	/** `#RRGGBB`. */
	color: string
	/** Not validated; the `current_status_motion` variable is empty without it. */
	animation?: string
	selectable: boolean
	/** Not validated; read only as the status's freshness. */
	updatedAt?: string | null
}

/** What one Entity stands at: `statusId` what everybody sees, `chosenStatusId` what it chose. */
export interface IntegrationEntityStatusView {
	entityId: string
	statusId: string
	chosenStatusId: string
	/** Not validated; the freshness rules then fall back to request ordering. */
	changedAt?: string | null
}

/** One macro of `macros.query.listMacros`; the snapshot adds `runnable`. */
export interface IntegrationMacroView {
	id: string
	name: string
	color: string
	running: boolean
	runStartedAt?: string | null
	updatedAt?: string | null
	/** Present in the snapshot only: whether this connection may run it. */
	runnable?: boolean
}

/** `GET /api/v2/snapshot`, the parts the module reads. */
export interface IntegrationSnapshot {
	workspace: { id: string | null; name: string; timeZone?: string }
	entity: { id: string; displayIdentity: string; protected?: boolean }
	participants: Array<{ id: string; displayIdentity: string; held?: boolean }>
	statuses: { statuses: IntegrationStatusView[]; entities: IntegrationEntityStatusView[] }
	macros: IntegrationMacroView[]
}

/** `intercom.query.getControls`, and the answer of `intercom.command.setControls`. */
export interface IntegrationIntercomControls {
	inputMuted: boolean
	outputMuted: boolean
	globalTalk: { held: boolean; talkKey: 'push' | 'latch' | null }
	groupTalk: Array<{ groupId: string; talkKey: 'push' | 'latch' }>
	call: { callerId: string } | null
	ringing: Array<{ callerId: string }>
	audio: { connected: boolean; sending: boolean }
	/** Not validated; the freshness rules then fall back to request ordering. */
	changedAt?: string | null
}

/** One group of `intercom.query.listGroups`, with the Entity's own listening of it. */
export interface IntegrationGroupView {
	id: string
	/** Null for the Everyone group, whose shown name the module supplies. */
	name: string | null
	everyone: boolean
	members: string[]
	/** Null where the Entity keeps no listening of the group. */
	listening: { gainDb: number; muted: boolean } | null
}

/** `intercom.query.listGroups`, the parts the module reads. */
export interface IntegrationGroupList {
	groups: IntegrationGroupView[]
}

/** An event envelope as `/api/v2/events` writes it (crewlan-v2 `docs/events.md` `## Event Envelope`). */
export interface IntegrationEventEnvelope {
	/** Not validated and unread: a gap is closed by a snapshot, never by a replay. */
	id?: string
	wireId: string
	occurredAt: string
	payload: Record<string, unknown>
}
