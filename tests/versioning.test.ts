import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFullSemver,
  assertPublicVersion,
  internalReleaseTag,
  nextInternalVersion,
  publicDownloadTag,
  publicPackageAsset,
  publicPackageVersion,
} from "../scripts/module-version.mjs";

describe("Companion module versioning", () => {
  it("maps public versions to package SemVer and download assets", () => {
    assert.equal(publicPackageVersion("1.2"), "1.2.0");
    assert.equal(publicPackageAsset("1.2"), "crewlan-connect-companion-1.2.tgz");
    assert.equal(publicDownloadTag("1.2"), "crewlan-connect-public-v1.2");
  });

  it("calculates the next internal development line", () => {
    assert.equal(nextInternalVersion("1.2"), "1.3.1");
  });

  it("keeps internal release tags on full SemVer", () => {
    assert.equal(internalReleaseTag("1.2.102"), "companion-v1.2.102");
  });

  it("rejects invalid public and internal versions", () => {
    assert.throws(() => assertPublicVersion("1.2.0"));
    assert.throws(() => assertFullSemver("1.2"));
  });
});
