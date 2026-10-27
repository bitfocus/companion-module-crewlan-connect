import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanionActionInfo } from '@companion-module/base'
import ModuleInstance from '../src/main.js'
import { UpdateActions } from '../src/actions.js'
import { wireRequests } from '../src/api-v2.js'
import { isConnectionReady } from '../src/feedbacks.js'
import type { CrewLanState } from '../src/types.js'

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

describe('Companion action placement', () => {
	type Placement = (action: CompanionActionInfo) => void

	/** A module whose state says `requests` are offered, and the definitions Companion was given. */
	function placedModule(requests: string[]): {
		instance: ModuleInstance
		definitions: () => Record<string, { subscribe?: Placement; unsubscribe?: Placement }>
		checked: string[]
	} {
		let definitions: Record<string, { subscribe?: Placement; unsubscribe?: Placement }> = {}
		const checked: string[] = []
		;(globalThis as { COMPANION_LOGGER?: unknown }).COMPANION_LOGGER = () => undefined
		const instance = new ModuleInstance({
			id: 'test',
			label: 'test',
			_isInstanceContext: true,
			setActionDefinitions: (captured: typeof definitions) => {
				definitions = captured
			},
			setFeedbackDefinitions: () => undefined,
			setPresetDefinitions: () => undefined,
			setVariableDefinitions: () => undefined,
			setVariableValues: () => undefined,
			checkFeedbacks: (ids: string[]) => checked.push(...ids),
		})

		instance.updateActions()
		;(instance as unknown as { updateState(patch: Partial<CrewLanState>): void }).updateState({
			connected: true,
			requests,
		})

		return { instance, definitions: () => definitions, checked }
	}

	it('greys a placed button whose request the offer withholds, and un-greys it once its action goes', () => {
		const { instance, definitions, checked } = placedModule([wireRequests.setEntityStatus])
		const talk = { id: 'act-1', controlId: 'btn-talk', actionId: 'talk_push_down', options: {} }
		const status = { id: 'act-2', controlId: 'btn-status', actionId: 'set_status', options: {} }
		checked.length = 0

		definitions().talk_push_down?.subscribe?.(talk)
		definitions().set_status?.subscribe?.(status)

		assert.equal(isConnectionReady(instance, 'btn-talk'), false)
		assert.equal(isConnectionReady(instance, 'btn-status'), true)
		assert.ok(checked.includes('connection_ready'))

		checked.length = 0
		definitions().talk_push_down?.unsubscribe?.(talk)

		assert.equal(isConnectionReady(instance, 'btn-talk'), true)
		assert.ok(checked.includes('connection_ready'))
	})

	it('greys a button when one of the actions placed on it is withheld', () => {
		const { instance, definitions } = placedModule([wireRequests.setEntityStatus])

		definitions().set_status?.subscribe?.({ id: 'act-1', controlId: 'btn', actionId: 'set_status', options: {} })
		assert.equal(isConnectionReady(instance, 'btn'), true)
		definitions().run_macro?.subscribe?.({ id: 'act-2', controlId: 'btn', actionId: 'run_macro', options: {} })
		assert.equal(isConnectionReady(instance, 'btn'), false)
		definitions().run_macro?.unsubscribe?.({ id: 'act-2', controlId: 'btn', actionId: 'run_macro', options: {} })
		assert.equal(isConnectionReady(instance, 'btn'), true)
	})
})
