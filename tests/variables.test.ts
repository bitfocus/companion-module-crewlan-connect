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
	it('names the API spoken, the Input mute, the caller and the call partner over v2', () => {
		const intercom = {
			groups: [],
			inputMuted: true,
			audioConnected: true,
			ringing: { id: 'ent-2', name: 'Anna' },
			calling: null,
			call: null,
			callTalkHeld: false,
			callTalkKey: null,
		}
		const ringing = valuesFor({ api: 'v2', intercom })

		assert.equal(ringing.api_version, 'v2')
		assert.equal(ringing.input_muted, true)
		assert.equal(ringing.intercom_ringing_caller, 'Anna')
		assert.equal(ringing.intercom_call_partner, '')

		const inCall = valuesFor({
			api: 'v2',
			intercom: { ...intercom, ringing: null, call: { id: 'ent-4', name: 'Chris' } },
		})
		assert.equal(inCall.intercom_ringing_caller, '')
		assert.equal(inCall.intercom_call_partner, 'Chris')

		// One's own call names its partner while it still rings, so Hang up shows whom it cancels.
		const calling = valuesFor({
			api: 'v2',
			intercom: { ...intercom, ringing: null, calling: { id: 'ent-4', name: 'Chris' } },
		})
		assert.equal(calling.intercom_ringing_caller, '')
		assert.equal(calling.intercom_call_partner, 'Chris')
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
