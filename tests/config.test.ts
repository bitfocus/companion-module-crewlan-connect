import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetConfigFields,
  migrateLegacyEntityToken,
  resolveEntityToken,
  type ModuleConfig,
  type ModuleSecrets,
} from "../src/config.js";
import { UpgradeScripts } from "../src/upgrades.js";

const baseConfig: ModuleConfig = {
  baseUrl: "http://127.0.0.1:4848",
  pollIntervalMs: 5000,
};

describe("Companion config", () => {
  it("stores the connection token as a Companion secret", () => {
    const tokenField = GetConfigFields().find((field) => field.id === "entityToken");

    assert.equal(tokenField?.type, "secret-text");
    assert.equal(tokenField?.label, "Connection token");
  });

  it("resolves secrets before legacy config tokens", () => {
    const config: ModuleConfig = { ...baseConfig, entityToken: " cle_legacy " };
    const secrets: ModuleSecrets = { entityToken: " cle_secret " };

    assert.equal(resolveEntityToken(config, secrets), "cle_secret");
  });

  it("migrates legacy config tokens into secrets", () => {
    const config: ModuleConfig = { ...baseConfig, entityToken: " cle_legacy " };
    const result = migrateLegacyEntityToken(config);

    assert.equal(result.migrated, true);
    assert.equal(result.config.entityToken, undefined);
    assert.equal(result.secrets?.entityToken, "cle_legacy");
  });

  it("removes legacy config tokens without overwriting existing secrets", () => {
    const config: ModuleConfig = { ...baseConfig, entityToken: "cle_legacy" };
    const secrets: ModuleSecrets = { entityToken: "cle_secret" };
    const result = migrateLegacyEntityToken(config, secrets);

    assert.equal(result.migrated, true);
    assert.equal(result.config.entityToken, undefined);
    assert.equal(result.secrets?.entityToken, "cle_secret");
  });

  it("offers an upgrade script for legacy token storage", () => {
    const config: ModuleConfig = { ...baseConfig, entityToken: "cle_legacy" };
    const result = UpgradeScripts[0]?.(
      { currentConfig: config },
      {
        config,
        secrets: null,
        actions: [],
        feedbacks: [],
      },
    );

    assert.equal(result?.updatedConfig?.entityToken, undefined);
    assert.equal(result?.updatedSecrets?.entityToken, "cle_legacy");
  });
});
