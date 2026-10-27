import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type ModuleInstance from '../src/main.js'
import { UpdateActions } from '../src/actions.js'

type Callback = (event: { options: Record<string, unknown> }) => Promise<void>

const crewGroupId = 'grp-0123456789abcdef0123456789abcdef'

/** The action definitions against a module double that records every method call and its arguments. */
function actions(): { definitions: Record<string, { callback: Callback }>; calls: unknown[][] } {
	const calls: unknown[][] = []
	let definitions: Record<string, { callback: Callback }> | undefined
	const record =
		(name: string) =>
		async (...args: unknown[]) => {
			calls.push([name, ...args])
		}
	const self = {
		getCrewLanState: () => ({ intercom: null, indicators: [] }),
		getStatusChoices: () => [],
		getDefaultStatusChoice: () => '',
		getMacroChoices: () => [],
		getDefaultMacroChoice: () => '',
		runCrewLanAction: async (actionName: string, action: () => Promise<void>) => {
			calls.push(['runCrewLanAction', actionName])
			await action()
		},
		setInputMuteMode: record('setInputMuteMode'),
		setGroupTalk: record('setGroupTalk'),
		setGroupTalkLatchMode: record('setGroupTalkLatchMode'),
		setGroupMuteMode: record('setGroupMuteMode'),
		answerCall: record('answerCall'),
		setCallTalk: record('setCallTalk'),
		setCallTalkLatchMode: record('setCallTalkLatchMode'),
		hangUpCall: record('hangUpCall'),
		setActionDefinitions: (captured: Record<string, { callback: Callback }>) => {
			definitions = captured
		},
	} as unknown as ModuleInstance

	UpdateActions(self)
	assert.ok(definitions)

	return { definitions, calls }
}

describe('Companion intercom actions', () => {
	const cases: [string, Record<string, unknown>, unknown[][]][] = [
		[
			'input_mute',
			{ mode: 'on' },
			[
				['runCrewLanAction', 'Input Mute'],
				['setInputMuteMode', 'on'],
			],
		],
		[
			'group_talk_push_down',
			{ groupId: crewGroupId },
			[
				['runCrewLanAction', 'Group Talk Push Down'],
				['setGroupTalk', crewGroupId, true, 'push'],
			],
		],
		[
			'group_talk_push_up',
			{ groupId: crewGroupId },
			[
				['runCrewLanAction', 'Group Talk Push Up'],
				['setGroupTalk', crewGroupId, false, 'push'],
			],
		],
		[
			'group_talk_latch',
			{ groupId: 'everyone', mode: 'off' },
			[
				['runCrewLanAction', 'Group Talk Latch'],
				['setGroupTalkLatchMode', 'everyone', 'off'],
			],
		],
		[
			'group_mute',
			{ groupId: crewGroupId, mode: 'toggle' },
			[
				['runCrewLanAction', 'Group Mute'],
				['setGroupMuteMode', crewGroupId, 'toggle'],
			],
		],
		['call_answer', {}, [['runCrewLanAction', 'Answer'], ['answerCall']]],
		[
			'call_talk_push_down',
			{},
			[
				['runCrewLanAction', 'Direct Talk Push Down'],
				['setCallTalk', true, 'push'],
			],
		],
		[
			'call_talk_push_up',
			{},
			[
				['runCrewLanAction', 'Direct Talk Push Up'],
				['setCallTalk', false, 'push'],
			],
		],
		[
			'call_talk_latch',
			{ mode: 'on' },
			[
				['runCrewLanAction', 'Direct Talk Latch'],
				['setCallTalkLatchMode', 'on'],
			],
		],
		['call_hang_up', {}, [['runCrewLanAction', 'Hang up'], ['hangUpCall']]],
	]

	for (const [actionId, options, expected] of cases) {
		it(`${actionId} passes its options to the module`, async () => {
			const { definitions, calls } = actions()
			const definition = definitions[actionId]
			assert.ok(definition, actionId)

			await definition.callback({ options })

			assert.deepEqual(calls, expected)
		})
	}

	it('reads an unknown mode as a toggle', async () => {
		const { definitions, calls } = actions()

		await definitions.group_mute?.callback({ options: { groupId: 'everyone', mode: 'bogus' } })

		assert.deepEqual(calls.at(-1), ['setGroupMuteMode', 'everyone', 'toggle'])
	})
})
