import type { CompanionStaticUpgradeScript } from "@companion-module/base";
import {
  migrateLegacyEntityToken,
  type ModuleConfig,
  type ModuleSecrets,
} from "./config.js";

export const UpgradeScripts: CompanionStaticUpgradeScript<
  ModuleConfig,
  ModuleSecrets | undefined
>[] = [
  (_context, props) => {
    if (props.config === null) {
      return {
        updatedConfig: null,
        updatedSecrets: null,
        updatedActions: [],
        updatedFeedbacks: [],
      };
    }

    const migration = migrateLegacyEntityToken(
      props.config,
      props.secrets ?? undefined,
    );

    return {
      updatedConfig: migration.migrated ? migration.config : null,
      updatedSecrets: migration.migrated ? migration.secrets : null,
      updatedActions: [],
      updatedFeedbacks: [],
    };
  },
];
