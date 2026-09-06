import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertModuleVersion, packageAsset, readPackageVersion, releaseTag } from '../scripts/module-version.mjs'

describe('Companion module versioning', () => {
	it('names the release tag and the interim-channel asset after the module version', () => {
		assert.equal(releaseTag('1.4.1'), 'v1.4.1')
		assert.equal(packageAsset('1.4.1'), 'crewlan-connect-1.4.1.tgz')
	})

	it('gives the interim channel the same version number as the module itself', () => {
		// package.json is the only place a version is written by hand; companion-module-build copies
		// it into the manifest (tests/manifest.test.ts pins the 0.0.0 placeholder that proves there is
		// no second number to drift from).
		const version = readPackageVersion('package.json')

		assert.equal(releaseTag(version), `v${version}`)
		assert.equal(packageAsset(version), `crewlan-connect-${version}.tgz`)
	})

	it('rejects anything that is not a full SemVer module version', () => {
		assert.throws(() => assertModuleVersion('1.2'))
		assert.throws(() => assertModuleVersion('v1.2.3'))
		assert.throws(() => assertModuleVersion('1.2.3-beta'))
	})
})
