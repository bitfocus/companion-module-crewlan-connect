import type { JsonObject, SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig extends JsonObject {
	baseUrl: string
	/** Legacy (v1.0) token location; migrated into secrets by the upgrade script. */
	entityToken?: string
	pollIntervalMs: number
}

export interface ModuleSecrets extends JsonObject {
	entityToken?: string
}

export interface TokenMigrationResult {
	config: ModuleConfig
	secrets: ModuleSecrets | undefined
	migrated: boolean
}

export const defaultPollIntervalMs = 5000
export const minPollIntervalMs = 1000
export const maxPollIntervalMs = 60000

/** Regex string (Companion format) accepting an http(s) URL without whitespace. */
export const baseUrlRegex = '/^https?:\\/\\/\\S+$/i'
/** Regex string (Companion format) for a typed CrewLAN status id. */
export const statusIdRegex = '/^[A-Za-z0-9_.:-]+$/'

export function normalizedToken(token: unknown): string {
	return typeof token === 'string' ? token.trim() : ''
}

export function resolveEntityToken(config: ModuleConfig, secrets?: ModuleSecrets): string {
	const secretToken = normalizedToken(secrets?.entityToken)

	if (secretToken.length > 0) {
		return secretToken
	}

	return normalizedToken(config.entityToken)
}

export function resolvePollIntervalMs(config: ModuleConfig): number {
	const configured = Number(config.pollIntervalMs)

	if (!Number.isFinite(configured)) {
		return defaultPollIntervalMs
	}

	return Math.min(maxPollIntervalMs, Math.max(minPollIntervalMs, configured))
}

export function migrateLegacyEntityToken(config: ModuleConfig, secrets?: ModuleSecrets): TokenMigrationResult {
	const hasLegacyTokenField = typeof config.entityToken === 'string'

	if (!hasLegacyTokenField) {
		return { config, secrets, migrated: false }
	}

	const legacyToken = normalizedToken(config.entityToken)
	const secretToken = normalizedToken(secrets?.entityToken)
	const nextConfig: ModuleConfig = { ...config }
	delete nextConfig.entityToken

	if (secretToken.length > 0 || legacyToken.length === 0) {
		return { config: nextConfig, secrets, migrated: true }
	}

	const nextSecrets: ModuleSecrets = { ...(secrets ?? {}) }
	nextSecrets.entityToken = legacyToken

	return {
		config: nextConfig,
		secrets: nextSecrets,
		migrated: true,
	}
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'baseUrl',
			label: 'Address',
			width: 8,
			default: 'http://127.0.0.1:4848',
			regex: baseUrlRegex,
			tooltip: 'Base URL of the CrewLAN host including the port, for example http://192.168.1.20:4848.',
			description:
				'The CrewLAN host this connection talks to. A path is kept so CrewLAN can sit behind a reverse proxy; a trailing /api or /api/v1 is removed.',
		},
		{
			type: 'secret-text',
			id: 'entityToken',
			label: 'Connection token',
			width: 12,
			default: '',
			minLength: 1,
			tooltip: 'Token created in CrewLAN for this Bitfocus Companion connection.',
			description:
				'Create the token in CrewLAN under the entity you want to control. It must grant exactly one entity.',
		},
		{
			type: 'number',
			id: 'pollIntervalMs',
			label: 'Poll fallback interval (ms)',
			width: 4,
			min: minPollIntervalMs,
			max: maxPollIntervalMs,
			default: defaultPollIntervalMs,
			tooltip: 'How often state is refreshed over HTTP while the live event stream is unavailable.',
			description:
				'Live updates arrive through the CrewLAN event stream. This interval is only used to refresh state while that stream is down; while it is connected the module reconciles every 30 s (or this interval, if longer).',
		},
	]
}
