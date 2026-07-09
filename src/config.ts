import {
  Regex,
  type JsonObject,
  type SomeCompanionConfigField,
} from "@companion-module/base";

export interface ModuleConfig extends JsonObject {
  baseUrl: string;
  entityToken?: string;
  pollIntervalMs: number;
}

export interface ModuleSecrets extends JsonObject {
  entityToken?: string;
}

export interface TokenMigrationResult {
  config: ModuleConfig;
  secrets: ModuleSecrets | undefined;
  migrated: boolean;
}

export function normalizedToken(token: unknown): string {
  return typeof token === "string" ? token.trim() : "";
}

export function resolveEntityToken(
  config: ModuleConfig,
  secrets?: ModuleSecrets,
): string {
  const secretToken = normalizedToken(secrets?.entityToken);

  if (secretToken.length > 0) {
    return secretToken;
  }

  return normalizedToken(config.entityToken);
}

export function migrateLegacyEntityToken(
  config: ModuleConfig,
  secrets?: ModuleSecrets,
): TokenMigrationResult {
  const hasLegacyTokenField = typeof config.entityToken === "string";

  if (!hasLegacyTokenField) {
    return { config, secrets, migrated: false };
  }

  const legacyToken = normalizedToken(config.entityToken);
  const secretToken = normalizedToken(secrets?.entityToken);
  const nextConfig: ModuleConfig = { ...config };
  delete nextConfig.entityToken;

  if (secretToken.length > 0 || legacyToken.length === 0) {
    return { config: nextConfig, secrets, migrated: true };
  }

  const nextSecrets: ModuleSecrets = { ...(secrets ?? {}) };
  nextSecrets.entityToken = legacyToken;

  return {
    config: nextConfig,
    secrets: nextSecrets,
    migrated: true,
  };
}

export function GetConfigFields(): SomeCompanionConfigField[] {
  return [
    {
      type: "textinput",
      id: "baseUrl",
      label: "Address",
      width: 8,
      default: "http://127.0.0.1:4848",
      regex: Regex.SOMETHING,
    },
    {
      type: "secret-text",
      id: "entityToken",
      label: "Connection token",
      width: 12,
      default: "",
      regex: Regex.SOMETHING,
    },
    {
      type: "number",
      id: "pollIntervalMs",
      label: "Poll fallback (ms)",
      width: 4,
      min: 1000,
      max: 60000,
      default: 5000,
    },
  ];
}
