import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { validateManifest, type ModuleManifest } from '@companion-module/base/manifest'

function readManifest(): ModuleManifest {
	return JSON.parse(readFileSync('companion/manifest.json', 'utf8')) as ModuleManifest
}

describe('Companion manifest', () => {
	it('matches the Bitfocus module identity', () => {
		const manifest = readManifest()

		validateManifest(manifest, false)
		assert.equal(manifest.id, 'crewlan-connect')
		assert.deepEqual(manifest.legacyIds, [])
		assert.equal(manifest.repository, 'git+https://github.com/bitfocus/companion-module-crewlan-connect.git')
		assert.equal(manifest.bugs, 'https://github.com/bitfocus/companion-module-crewlan-connect/issues')
		assert.equal(manifest.version, '0.0.0')
		assert.equal(manifest.runtime.apiVersion, '0.0.0')
	})
})
