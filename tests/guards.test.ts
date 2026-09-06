import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPublicMacroDto, isPublicMacroDtoList, isPublicMacroRemovedEventData } from '../src/guards.js'

function macro(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'macro-showstart',
		label: 'Show Start',
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		running: false,
		runnable: true,
		sortOrder: 10,
		runStartedAt: null,
		updatedAt: '2026-08-03T18:00:00.000Z',
		...overrides,
	}
}

describe('macro guards', () => {
	it('accepts a macro that carries the fields the module reads', () => {
		assert.equal(isPublicMacroDto(macro()), true)
	})

	it('accepts a macro with extra fields a newer CrewLAN may add', () => {
		assert.equal(isPublicMacroDto(macro({ stepCount: 7, owner: 'alex' })), true)
	})

	it('accepts a macro that omits the optional ordering fields', () => {
		const partial = macro()
		delete partial.sortOrder
		delete partial.runStartedAt
		delete partial.updatedAt

		assert.equal(isPublicMacroDto(partial), true)
	})

	it('rejects a macro that is missing state the buttons depend on', () => {
		const withoutRunning = macro()
		delete withoutRunning.running

		assert.equal(isPublicMacroDto(withoutRunning), false)
		assert.equal(isPublicMacroDto(macro({ runnable: 'yes' })), false)
		assert.equal(isPublicMacroDto(macro({ colors: { backgroundColor: '#0fcf29' } })), false)
		assert.equal(isPublicMacroDto(macro({ label: 42 })), false)
		assert.equal(isPublicMacroDto(null), false)
	})

	it('validates a whole list', () => {
		assert.equal(isPublicMacroDtoList([macro(), macro({ id: 'macro-2' })]), true)
		assert.equal(isPublicMacroDtoList([macro(), { id: 'broken' }]), false)
		assert.equal(isPublicMacroDtoList({}), false)
	})

	it('validates the removal payload', () => {
		assert.equal(isPublicMacroRemovedEventData({ id: 'macro-1' }), true)
		assert.equal(isPublicMacroRemovedEventData({}), false)
	})
})
