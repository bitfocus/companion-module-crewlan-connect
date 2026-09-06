/**
 * Release naming for the interim CrewLAN distribution channel.
 *
 * The Bitfocus module store is the intended channel for this module. Until it is approved and ships
 * with Companion, CrewLAN users still need a way to install it, so every release is also published
 * as the .tgz that `yarn package` produces, for manual import into Companion.
 *
 * There is exactly one version number, and both channels use it: the full SemVer in package.json.
 * `companion-module-build` stamps it into companion/manifest.json, the git tag is `v<version>`, and
 * the asset is `crewlan-connect-<version>.tgz`. The commands below read that number out of
 * package.json rather than taking it as an argument, so a release cannot be tagged or published
 * under a version that differs from the one Companion reports.
 *
 * This is repository tooling only: it is never packaged into the module, and it can be retired once
 * the module is available in the store.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const moduleVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u

export function assertModuleVersion(version) {
	if (!moduleVersionPattern.test(version)) {
		throw new Error(`Module version must be full SemVer like 1.2.3: ${version}`)
	}

	return version
}

/** The git tag for a release, in the form this repository already uses (v1.4.1). */
export function releaseTag(version) {
	return `v${assertModuleVersion(version)}`
}

/** The .tgz `yarn package` emits, which is also the asset the interim channel offers for download. */
export function packageAsset(version) {
	return `crewlan-connect-${assertModuleVersion(version)}.tgz`
}

export function readPackageVersion(packagePath = 'package.json') {
	const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
	return assertModuleVersion(String(packageJson.version))
}

/**
 * package.json is tab-indented and listed in .prettierignore, so nothing reformats it afterwards.
 * Writing it back with spaces would turn a one-line version bump into a whole-file diff.
 */
export function writePackageVersion(version, packagePath = 'package.json') {
	const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
	packageJson.version = assertModuleVersion(version)
	writeFileSync(packagePath, `${JSON.stringify(packageJson, null, '\t')}\n`)
}

function print(value) {
	process.stdout.write(`${value}\n`)
}

function main() {
	const [, , command, value, packagePath = 'package.json'] = process.argv

	switch (command) {
		case 'release-tag':
			print(releaseTag(readPackageVersion(value ?? packagePath)))
			return
		case 'package-asset':
			print(packageAsset(readPackageVersion(value ?? packagePath)))
			return
		case 'read-package-version':
			print(readPackageVersion(value ?? packagePath))
			return
		case 'set-package-version':
			writePackageVersion(String(value ?? ''), packagePath)
			return
		default:
			throw new Error(`Unknown module-version command: ${command ?? ''}`)
	}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
}
