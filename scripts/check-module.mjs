import { validateManifest } from "@companion-module/base/manifest";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("companion/manifest.json", "utf8"));

validateManifest(manifest, false);

if (manifest.id !== "crewlan-connect") {
  throw new Error("Manifest id must be crewlan-connect.");
}

if (!Array.isArray(manifest.legacyIds) || !manifest.legacyIds.includes("crewlan-v1")) {
  throw new Error("Manifest must keep crewlan-v1 as a legacy id.");
}

if (manifest.version !== "0.0.0" || manifest.runtime?.apiVersion !== "0.0.0") {
  throw new Error("Manifest version placeholders must stay Bitfocus-managed.");
}
