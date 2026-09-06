import type {
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
} from '@companion-module/base'
import { migrateLegacyEntityToken, type ModuleConfig, type ModuleSecrets } from './config.js'

type UpgradeSecrets = ModuleSecrets | undefined

/**
 * Moves the connection token from the plain config (v1.0 layout) into the Companion secret store.
 */
function moveEntityTokenToSecrets(
	_context: CompanionUpgradeContext<ModuleConfig>,
	props: CompanionStaticUpgradeProps<ModuleConfig, UpgradeSecrets>,
): CompanionStaticUpgradeResult<ModuleConfig, UpgradeSecrets> {
	if (props.config === null) {
		return {
			updatedConfig: null,
			updatedSecrets: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	}

	const migration = migrateLegacyEntityToken(props.config, props.secrets ?? undefined)

	return {
		updatedConfig: migration.migrated ? migration.config : null,
		updatedSecrets: migration.migrated ? (migration.secrets ?? null) : null,
		updatedActions: [],
		updatedFeedbacks: [],
	}
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, UpgradeSecrets>[] = [moveEntityTokenToSecrets]
