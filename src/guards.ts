import type {
	IntegrationDescription,
	IntegrationDirectCall,
	IntegrationEntityStatusView,
	IntegrationEventEnvelope,
	IntegrationGroupList,
	IntegrationGroupView,
	IntegrationIndicatorOffer,
	IntegrationIndicatorView,
	IntegrationIntercomControls,
	IntegrationMacroView,
	IntegrationOffer,
	IntegrationSnapshot,
	IntegrationStatusView,
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
 * Only the fields the module needs are checked, so a newer CrewLAN that adds fields still
 * validates. A payload that fails a guard is rejected at the API boundary instead of throwing a
 * TypeError later inside a feedback or variable callback.
 *
 * The checks here and the optionality in `types.ts` are two halves of one statement: a field this
 * file does not check is declared optional there, so the compiler makes every reader handle its
 * absence. Tightening a guard therefore means making the matching field required, and dropping a
 * check means making it optional.
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

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isTalkKey(value: unknown): value is 'push' | 'latch' {
	return value === 'push' || value === 'latch'
}

function isIntegrationDirectCall(value: unknown): value is IntegrationDirectCall {
	return (
		isRecord(value) &&
		isString(value.partnerId) &&
		(value.direction === 'incoming' || value.direction === 'outgoing') &&
		(value.state === 'ringing' || value.state === 'active' || value.state === 'ended') &&
		isRecord(value.talk) &&
		isBoolean(value.talk.held) &&
		(value.talk.talkKey === undefined || value.talk.talkKey === null || isTalkKey(value.talk.talkKey))
	)
}

export function isIntegrationIndicatorOffer(value: unknown): value is IntegrationIndicatorOffer {
	return isRecord(value) && isString(value.indicatorId) && isArrayOf(value.statusIds, isString)
}

/** `GET /api/v2`'s `requests` and `indicators`, and the stream's `offer` record, which carries those two alone. */
export function isIntegrationOffer(value: unknown): value is IntegrationOffer {
	return (
		isRecord(value) &&
		isArrayOf(
			value.requests,
			(request): request is { wireId: string } => isRecord(request) && isString(request.wireId),
		) &&
		(value.indicators === undefined || isArrayOf(value.indicators, isIntegrationIndicatorOffer))
	)
}

export function isIntegrationDescription(value: unknown): value is IntegrationDescription {
	return isRecord(value) && value.api === 'v2' && isIntegrationOffer(value)
}

export function isIntegrationIndicatorView(value: unknown): value is IntegrationIndicatorView {
	return isRecord(value) && isString(value.id) && isString(value.displayIdentity) && isString(value.statusId)
}

export function isIntegrationStatusView(value: unknown): value is IntegrationStatusView {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isBoolean(value.builtIn) &&
		isNullableString(value.label) &&
		isString(value.color) &&
		isBoolean(value.selectable)
	)
}

export function isIntegrationEntityStatusView(value: unknown): value is IntegrationEntityStatusView {
	return isRecord(value) && isString(value.entityId) && isString(value.statusId) && isString(value.chosenStatusId)
}

export function isIntegrationMacroView(value: unknown): value is IntegrationMacroView {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.name) &&
		isString(value.color) &&
		isBoolean(value.running) &&
		(value.runnable === undefined || isBoolean(value.runnable))
	)
}

export function isIntegrationSnapshot(value: unknown): value is IntegrationSnapshot {
	return (
		isRecord(value) &&
		isRecord(value.workspace) &&
		isNullableString(value.workspace.id) &&
		isString(value.workspace.name) &&
		isRecord(value.entity) &&
		isString(value.entity.id) &&
		isString(value.entity.displayIdentity) &&
		(value.entity.kind === undefined || isString(value.entity.kind)) &&
		(value.entity.attends === undefined || isBoolean(value.entity.attends)) &&
		isArrayOf(
			value.participants,
			(participant): participant is { id: string; displayIdentity: string } =>
				isRecord(participant) && isString(participant.id) && isString(participant.displayIdentity),
		) &&
		isRecord(value.statuses) &&
		isArrayOf(value.statuses.statuses, isIntegrationStatusView) &&
		isArrayOf(value.statuses.entities, isIntegrationEntityStatusView) &&
		(value.statuses.indicators === undefined || isArrayOf(value.statuses.indicators, isIntegrationIndicatorView)) &&
		isArrayOf(value.macros, isIntegrationMacroView)
	)
}

export function isIntegrationIntercomControls(value: unknown): value is IntegrationIntercomControls {
	return (
		isRecord(value) &&
		isBoolean(value.inputMuted) &&
		isBoolean(value.outputMuted) &&
		isRecord(value.globalTalk) &&
		isBoolean(value.globalTalk.held) &&
		(value.globalTalk.talkKey === null || isTalkKey(value.globalTalk.talkKey)) &&
		isArrayOf(
			value.groupTalk,
			(entry): entry is { groupId: string; talkKey: 'push' | 'latch' } =>
				isRecord(entry) && isString(entry.groupId) && isTalkKey(entry.talkKey),
		) &&
		(value.directCall === undefined || value.directCall === null || isIntegrationDirectCall(value.directCall)) &&
		isRecord(value.audio) &&
		isBoolean(value.audio.connected) &&
		isBoolean(value.audio.sending)
	)
}

export function isIntegrationGroupView(value: unknown): value is IntegrationGroupView {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isNullableString(value.name) &&
		isBoolean(value.everyone) &&
		isArrayOf(value.members, isString) &&
		(value.listening === null ||
			(isRecord(value.listening) && isNumber(value.listening.gainDb) && isBoolean(value.listening.muted)))
	)
}

export function isIntegrationGroupList(value: unknown): value is IntegrationGroupList {
	return isRecord(value) && isArrayOf(value.groups, isIntegrationGroupView)
}

export function isIntegrationEventEnvelope(value: unknown): value is IntegrationEventEnvelope {
	return isRecord(value) && isString(value.wireId) && isString(value.occurredAt) && isRecord(value.payload)
}
