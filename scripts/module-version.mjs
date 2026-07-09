import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const fullSemverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const publicVersionPattern = /^[0-9]+\.[0-9]+$/u;

export function assertFullSemver(version) {
  if (!fullSemverPattern.test(version)) {
    throw new Error(`Version must be full SemVer like 1.2.3: ${version}`);
  }

  return version;
}

export function assertPublicVersion(version) {
  if (!publicVersionPattern.test(version)) {
    throw new Error(`Public version must look like 1.2: ${version}`);
  }

  return version;
}

export function publicPackageVersion(publicVersion) {
  return `${assertPublicVersion(publicVersion)}.0`;
}

export function publicPackageAsset(publicVersion) {
  return `crewlan-connect-companion-${assertPublicVersion(publicVersion)}.tgz`;
}

export function publicDownloadTag(publicVersion) {
  return `crewlan-connect-public-v${assertPublicVersion(publicVersion)}`;
}

export function internalReleaseTag(internalVersion) {
  return `companion-v${assertFullSemver(internalVersion)}`;
}

export function nextInternalVersion(publicVersion) {
  const [major, minor] = assertPublicVersion(publicVersion).split(".").map(Number);
  return `${major}.${minor + 1}.1`;
}

export function readPackageVersion(packagePath = "package.json") {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  return assertFullSemver(String(packageJson.version));
}

export function writePackageVersion(version, packagePath = "package.json") {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.version = assertFullSemver(version);
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function print(value) {
  process.stdout.write(`${value}\n`);
}

function main() {
  const [, , command, value, packagePath = "package.json"] = process.argv;

  switch (command) {
    case "public-package-version":
      print(publicPackageVersion(String(value ?? "")));
      return;
    case "public-package-asset":
      print(publicPackageAsset(String(value ?? "")));
      return;
    case "public-download-tag":
      print(publicDownloadTag(String(value ?? "")));
      return;
    case "internal-release-tag":
      print(internalReleaseTag(String(value ?? "")));
      return;
    case "next-internal-version":
      print(nextInternalVersion(String(value ?? "")));
      return;
    case "read-package-version":
      print(readPackageVersion(value ?? packagePath));
      return;
    case "set-package-version":
      writePackageVersion(String(value ?? ""), packagePath);
      return;
    default:
      throw new Error(`Unknown module-version command: ${command ?? ""}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
