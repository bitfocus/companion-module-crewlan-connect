import type {
	PublicAlertTriggeredEventData,
	PublicMacroDto,
	PublicMacroRemovedEventData,
	PublicDismissEntityAlertsDto,
	PublicEntityControlsDto,
	PublicEntityDto,
	PublicEntityStatusDto,
	PublicEventEnvelope,
	PublicSessionDto,
	PublicStatusDto,
	PublicWorkspaceDto,
} from './types.js'

/**
 * Narrow runtime guards for every CrewLAN Public API payload the module consumes.
 *
 * Only the fields the module actually reads are checked, so a newer CrewLAN that adds
 * fields still validates. A payload that fails a guard is rejected at the API boundary
 * instead of throwing a TypeError later inside a feedback or variable callback.
 */

export type Guard<T> = (value: unknown) => value is T

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
	return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string'
}

function isArrayOf<T>(value: unknown, guard: Guard<T>): value is T[] {
	return Array.isArray(value) && value.every((entry) => guard(entry))
}

export function isPublicSessionDto(value: unknown): value is PublicSessionDto {
	return (
		isRecord(value) &&
		isRecord(value.workspace) &&
		isBoolean(value.workspace.granted) &&
		isArrayOf(
			value.entities,
			(entry): entry is PublicSessionDto['entities'][number] =>
				isRecord(entry) && isString(entry.entityId) && isBoolean(entry.granted),
		)
	)
}

export function isPublicWorkspaceDto(value: unknown): value is PublicWorkspaceDto {
	return isRecord(value) && isNullableString(value.id) && isString(value.name)
}

export function isPublicStatusDto(value: unknown): value is PublicStatusDto {
	return (
		isRecord(value) &&
		isString(value.id) &&
		(value.kind === 'system' || value.kind === 'custom') &&
		isString(value.label) &&
		isRecord(value.colors) &&
		isString(value.colors.backgroundColor) &&
		isString(value.colors.foregroundColor) &&
		isBoolean(value.selectable)
	)
}

export function isPublicStatusDtoList(value: unknown): value is PublicStatusDto[] {
	return isArrayOf(value, isPublicStatusDto)
}

/**
 * `sortOrder` and `runStartedAt` are deliberately not checked: a macro that omits them must still
 * be usable, it only falls back to label ordering.
 */
export function isPublicMacroDto(value: unknown): value is PublicMacroDto {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.label) &&
		isRecord(value.colors) &&
		isString(value.colors.backgroundColor) &&
		isString(value.colors.foregroundColor) &&
		isBoolean(value.running) &&
		isBoolean(value.runnable) &&
		(value.updatedAt === undefined || isNullableString(value.updatedAt))
	)
}

export function isPublicMacroDtoList(value: unknown): value is PublicMacroDto[] {
	return isArrayOf(value, isPublicMacroDto)
}

export function isPublicMacroRemovedEventData(value: unknown): value is PublicMacroRemovedEventData {
	return isRecord(value) && isString(value.id)
}

export function isPublicEntityDto(value: unknown): value is PublicEntityDto {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.displayName) &&
		(value.position === undefined || isNullableString(value.position))
	)
}

export function isPublicEntityStatusDto(value: unknown): value is PublicEntityStatusDto {
	return (
		isRecord(value) &&
		isString(value.entityId) &&
		isPublicStatusDto(value.status) &&
		isString(value.selectedStatusId) &&
		(value.updatedAt === undefined || isNullableString(value.updatedAt))
	)
}

export function isPublicEntityControlsDto(value: unknown): value is PublicEntityControlsDto {
	if (!isRecord(value) || !isString(value.entityId) || !isRecord(value.shoutbox)) {
		return false
	}

	const { listen, talk } = value.shoutbox

	return (
		isRecord(listen) &&
		isBoolean(listen.enabled) &&
		isBoolean(listen.muted) &&
		isBoolean(listen.available) &&
		isRecord(talk) &&
		isBoolean(talk.enabled) &&
		isBoolean(talk.active) &&
		isBoolean(talk.live) &&
		(talk.controlMode === null || talk.controlMode === 'push' || talk.controlMode === 'latch') &&
		isBoolean(talk.available) &&
		(value.updatedAt === undefined || isNullableString(value.updatedAt))
	)
}

export function isPublicDismissEntityAlertsDto(value: unknown): value is PublicDismissEntityAlertsDto {
	return isRecord(value) && isString(value.entityId) && typeof value.dismissedCount === 'number'
}

export function isPublicAlertTriggeredEventData(value: unknown): value is PublicAlertTriggeredEventData {
	return (
		isRecord(value) &&
		(value.scope === 'workspace' || value.scope === 'entities') &&
		(value.targetEntityIds === null || isArrayOf(value.targetEntityIds, isString))
	)
}

export function isPublicEventEnvelope(value: unknown): value is PublicEventEnvelope {
	return isRecord(value) && isString(value.type) && isString(value.occurredAt) && 'data' in value
}

/** Guard for the `{ data: T, meta }` wrapper used by every REST response. */
export function isItemResponse<T>(guard: Guard<T>): Guard<{ data: T }> {
	return (value): value is { data: T } => isRecord(value) && guard(value.data)
}

export function isAnything(_value: unknown): _value is unknown {
	return true
}
