import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type ModuleInstance from '../src/main.js'
import type { CrewLanState } from '../src/types.js'
import { UpdateVariableValues } from '../src/variables.js'

function valuesFor(state: Partial<CrewLanState>): Record<string, unknown> {
	let captured: Record<string, unknown> | undefined
	const self = {
		getCrewLanState: () =>
			({
				statuses: [],
				macros: [],
				status: null,
				controls: null,
				workspace: null,
				entity: null,
				streamConnected: false,
				macrosSupported: false,
				lastAlert: '',
				lastError: '',
				api: null,
				intercom: null,
				...state,
			}) as unknown as CrewLanState,
		setVariableValues: (values: Record<string, unknown>) => {
			captured = values
		},
	} as unknown as ModuleInstance

	UpdateVariableValues(self)
	assert.ok(captured)

	return captured
}

describe('Companion intercom variables', () => {
	it('names the API spoken, the Input mute, the first caller and the call partner over v2', () => {
		const values = valuesFor({
			api: 'v2',
			intercom: {
				groups: [],
				inputMuted: true,
				audioConnected: true,
				ringing: [
					{ id: 'ent-2', name: 'Anna' },
					{ id: 'ent-3', name: 'Ben' },
				],
				call: { id: 'ent-4', name: 'Chris' },
			},
		})

		assert.equal(values.api_version, 'v2')
		assert.equal(values.input_muted, true)
		assert.equal(values.intercom_ringing_caller, 'Anna')
		assert.equal(values.intercom_call_partner, 'Chris')
	})

	it('is empty over v1 and before the first connect', () => {
		assert.equal(valuesFor({ api: 'v1' }).api_version, 'v1')

		const values = valuesFor({})
		assert.equal(values.api_version, '')
		assert.equal(values.input_muted, false)
		assert.equal(values.intercom_ringing_caller, '')
		assert.equal(values.intercom_call_partner, '')
	})
})
