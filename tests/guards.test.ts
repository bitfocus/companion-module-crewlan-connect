import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	isIntegrationIntercomControls,
	isPublicMacroDto,
	isPublicMacroDtoList,
	isPublicMacroRemovedEventData,
} from '../src/guards.js'

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

describe('intercom controls guard', () => {
	const controls = {
		inputMuted: false,
		outputMuted: false,
		globalTalk: { held: false, talkKey: null },
		groupTalk: [],
		audio: { connected: true, sending: false },
	}
	const call = { partnerId: 'ent-bob', direction: 'outgoing', state: 'active', talk: { held: true, talkKey: 'latch' } }
	const withCall = (directCall: unknown): unknown => ({ ...controls, directCall })

	it('accepts a direct call, none, and controls from a Workspace that predates it', () => {
		assert.equal(isIntegrationIntercomControls(withCall(call)), true)
		assert.equal(isIntegrationIntercomControls(withCall(null)), true)
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, talk: { held: false, talkKey: null } })), true)
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, talk: { held: false } })), true)
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, partnerTalks: true, reason: null })), true)
		assert.equal(isIntegrationIntercomControls(controls), true)
	})

	it('rejects a direct call that is missing or misstates what the buttons depend on', () => {
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, direction: 'sideways' })), false)
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, state: 'held' })), false)
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, talk: { held: 'yes' } })), false)
		assert.equal(isIntegrationIntercomControls(withCall({ ...call, talk: { held: true, talkKey: 'hold' } })), false)
		assert.equal(isIntegrationIntercomControls(withCall({ direction: 'incoming', state: 'ringing' })), false)
	})
})
