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
}

/** A dropdown entry, used for both status and macro pickers. */
export interface CrewLanChoice {
	id: string
	label: string
}
