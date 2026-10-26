import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type ModuleInstance from '../src/main.js'
import { UpdateFeedbacks } from '../src/feedbacks.js'
import type { CrewLanState, IntercomState, PublicEntityControlsDto } from '../src/types.js'

const crewGroupId = 'grp-0123456789abcdef0123456789abcdef'

type Callback = (feedback: { options: Record<string, unknown> }) => unknown
type Definition = { name: string; description?: string; callback: Callback; options: { id: string; regex?: string }[] }

function createIntercom(input: Partial<IntercomState> = {}): IntercomState {
	return {
		groups: [
			{ id: 'everyone', name: 'All', everyone: true, muted: false, gainDb: 0, talkHeld: false, talkKey: null },
			{ id: crewGroupId, name: 'Crew', everyone: false, muted: true, gainDb: -6, talkHeld: true, talkKey: 'latch' },
		],
		inputMuted: true,
		audioConnected: true,
		ringing: null,
		calling: null,
		call: null,
		callTalkHeld: false,
		callTalkKey: null,
		...input,
	}
}

function createControls(input: { muted?: boolean; available?: boolean } = {}): PublicEntityControlsDto {
	return {
		entityId: 'ent-1',
		shoutbox: {
			listen: { enabled: true, muted: input.muted ?? true, available: true },
			talk: { enabled: true, active: true, live: true, controlMode: 'push', available: input.available ?? true },
		},
	}
}

function createState(input: Partial<CrewLanState> = {}): CrewLanState {
	return {
		connected: true,
		streamConnected: true,
		entityId: 'ent-1',
		workspace: null,
		entity: null,
		statuses: [],
		macros: [],
		macrosSupported: false,
		status: null,
		controls: createControls(),
		lastAlert: '',
		lastError: '',
		api: 'v2',
		ownerPresent: true,
		intercom: createIntercom(),
		...input,
	}
}

function definitionsFor(state: CrewLanState): Record<string, Definition> {
	let captured: Record<string, Definition> | undefined
	const self = {
		getCrewLanState: () => state,
		getStatusChoices: () => [],
		getDefaultStatusChoice: () => '',
		getMacroChoices: () => [],
		getDefaultMacroChoice: () => '',
		setFeedbackDefinitions: (definitions: Record<string, Definition>) => {
			captured = definitions
		},
	} as unknown as ModuleInstance

	UpdateFeedbacks(self)
	assert.ok(captured)

	return captured
}

function value(state: CrewLanState, feedbackId: string, options: Record<string, unknown> = {}): unknown {
	const definition = definitionsFor(state)[feedbackId]
	assert.ok(definition, feedbackId)

	return definition.callback({ options })
}

describe('Companion intercom feedbacks', () => {
	it('is ready only while connected and the owner is present', () => {
		assert.equal(value(createState(), 'connection_ready'), true)
		assert.equal(value(createState({ connected: false }), 'connection_ready'), false)
		assert.equal(value(createState({ ownerPresent: false }), 'connection_ready'), false)
	})

	it('offers a group talk key only for a member group with audio, in a direct call too', () => {
		assert.equal(value(createState(), 'group_talk_available', { groupId: crewGroupId }), true)
		assert.equal(
			value(createState(), 'group_talk_available', { groupId: 'grp-ffffffffffffffffffffffffffffffff' }),
			false,
		)
		assert.equal(
			value(createState({ intercom: createIntercom({ audioConnected: false }) }), 'group_talk_available', {
				groupId: 'everyone',
			}),
			false,
		)
		assert.equal(
			value(
				createState({ intercom: createIntercom({ call: { id: 'ent-2', name: 'Anna' } }) }),
				'group_talk_available',
				{
					groupId: 'everyone',
				},
			),
			true,
		)
		assert.equal(value(createState({ ownerPresent: false }), 'group_talk_available', { groupId: 'everyone' }), false)
		assert.equal(value(createState({ intercom: null }), 'group_talk_available', { groupId: 'everyone' }), false)
	})

	it('reads a group talk key and mute from the group the option names', () => {
		assert.equal(value(createState(), 'group_talk_active', { groupId: crewGroupId }), true)
		assert.equal(value(createState(), 'group_talk_active', { groupId: 'everyone' }), false)
		assert.equal(value(createState(), 'group_muted', { groupId: crewGroupId }), true)
		assert.equal(value(createState(), 'group_muted', { groupId: 'everyone' }), false)
	})

	it('reads the Input mute, who rings, whom one calls and the active call', () => {
		const callFeedbacks = ['call_ringing', 'call_calling', 'call_active', 'answer_available', 'call_talk_available']
		const read = (state: CrewLanState): Record<string, unknown> =>
			Object.fromEntries(callFeedbacks.map((feedbackId) => [feedbackId, value(state, feedbackId)]))

		assert.equal(value(createState(), 'input_muted'), true)
		assert.deepEqual(read(createState()), {
			call_ringing: false,
			call_calling: false,
			call_active: false,
			answer_available: false,
			call_talk_available: false,
		})
		assert.deepEqual(read(createState({ intercom: createIntercom({ ringing: { id: 'ent-2', name: 'Anna' } }) })), {
			call_ringing: true,
			call_calling: false,
			call_active: false,
			answer_available: true,
			call_talk_available: false,
		})
		assert.deepEqual(read(createState({ intercom: createIntercom({ calling: { id: 'ent-2', name: 'Anna' } }) })), {
			call_ringing: false,
			call_calling: true,
			call_active: false,
			answer_available: false,
			call_talk_available: false,
		})
		assert.deepEqual(read(createState({ intercom: createIntercom({ call: { id: 'ent-2', name: 'Anna' } }) })), {
			call_ringing: false,
			call_calling: false,
			call_active: true,
			answer_available: false,
			call_talk_available: true,
		})
	})

	it("reads the call's Talk key, and offers it only during an active call with audio", () => {
		const inCall = { call: { id: 'ent-2', name: 'Anna' } }

		assert.equal(value(createState(), 'call_talk_active'), false)
		assert.equal(
			value(
				createState({ intercom: createIntercom({ ...inCall, callTalkHeld: true, callTalkKey: 'push' }) }),
				'call_talk_active',
			),
			true,
		)
		assert.equal(
			value(createState({ intercom: createIntercom({ ...inCall, audioConnected: false }) }), 'call_talk_available'),
			false,
		)
		assert.equal(
			value(createState({ ownerPresent: false, intercom: createIntercom(inCall) }), 'call_talk_available'),
			false,
		)
		assert.equal(value(createState({ intercom: null }), 'call_talk_available'), false)
	})

	it('keeps the state feedbacks on what CrewLAN reports while the owner is absent', () => {
		const waiting = createState({
			ownerPresent: false,
			intercom: createIntercom({
				ringing: { id: 'ent-2', name: 'Anna' },
				calling: { id: 'ent-2', name: 'Anna' },
				call: { id: 'ent-3', name: 'Ben' },
				callTalkHeld: true,
				callTalkKey: 'latch',
			}),
		})

		// A 1.x button and its $(crewlan:…) variable agree; the preset greys by its last feedback.
		for (const feedbackId of [
			'listen_muted',
			'talk_available',
			'talk_push_active',
			'input_muted',
			'call_ringing',
			'call_calling',
			'call_active',
			'call_talk_active',
		]) {
			assert.equal(value(waiting, feedbackId), true, feedbackId)
		}

		assert.equal(value(waiting, 'group_muted', { groupId: crewGroupId }), true)
		assert.equal(value(waiting, 'group_talk_active', { groupId: crewGroupId }), true)

		for (const feedbackId of ['connection_ready', 'answer_available', 'call_talk_available']) {
			assert.equal(value(waiting, feedbackId), false, feedbackId)
		}

		assert.equal(value(waiting, 'group_talk_available', { groupId: crewGroupId }), false)
		assert.equal(value(waiting, 'group_member', { groupId: crewGroupId }), false)
	})

	it('is a group member only while ready and the group is among the participant’s groups', () => {
		assert.equal(value(createState(), 'group_member', { groupId: crewGroupId }), true)
		assert.equal(value(createState({ connected: false }), 'group_member', { groupId: crewGroupId }), false)
		const left = createState({ intercom: createIntercom({ groups: createIntercom().groups.slice(0, 1) }) })
		assert.equal(value(left, 'group_member', { groupId: crewGroupId }), false)
		assert.equal(value(left, 'group_member', { groupId: 'everyone' }), true)
		assert.equal(value(createState({ intercom: null }), 'group_member', { groupId: 'everyone' }), false)
	})

	it('names the microphone feedback for what it reports, and a call as being in one', () => {
		const definitions = definitionsFor(createState())

		assert.equal(definitions.talk_live?.name, 'Microphone Live')
		assert.equal(definitions.talk_live?.description, 'True while CrewLAN reports the microphone as live on the device.')
		assert.equal(definitions.call_active?.name, 'Direct: In a Call')
	})

	it('offers the member groups in its group option and accepts a typed id', () => {
		const [option] = definitionsFor(createState()).group_muted?.options ?? []

		assert.equal(option?.id, 'groupId')
		assert.deepEqual((option as unknown as { choices: unknown }).choices, [
			{ id: 'everyone', label: 'All' },
			{ id: crewGroupId, label: 'Crew' },
		])
		assert.equal(option?.regex, '/^(everyone|grp-[0-9a-f]{32})$/')
	})

	it('names no Shoutbox in any feedback name or description', () => {
		for (const [id, definition] of Object.entries(definitionsFor(createState()))) {
			assert.doesNotMatch(`${definition.name} ${definition.description ?? ''}`, /shoutbox/iu, id)
		}
	})
})
