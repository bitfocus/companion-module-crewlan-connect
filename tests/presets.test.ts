import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from '../src/main.js'
import type { ModuleSchema } from '../src/main.js'
import { offlineBackgroundColor, offlineTextColor } from '../src/button-style.js'
import { UpdatePresets } from '../src/presets.js'
import type { CrewLanState, PublicMacroDto, PublicStatusDto } from '../src/types.js'

/** The state slice UpdatePresets reads: which API is spoken and the intercom over v2. */
function presetState(input: Partial<CrewLanState> = {}): CrewLanState {
	return { api: 'v1', intercom: null, requests: null, indicators: [], ...input } as CrewLanState
}

function createStatus(input: Partial<PublicStatusDto>): PublicStatusDto {
	return {
		id: 'sys-idle',
		kind: 'system',
		label: 'Idle',
		paletteKey: 'blue',
		colors: {
			backgroundColor: '#0fcf29',
			foregroundColor: '#101820',
		},
		alertType: null,
		motionPreset: 'none',
		selectable: true,
		...input,
	}
}

describe('Companion presets', () => {
	it('builds status presets offline-grey, dimmed while ready and lit while current', () => {
		let capturedPresets: CompanionPresetDefinitions<ModuleSchema> | undefined
		let capturedStructure: CompanionPresetSection<ModuleSchema>[] | undefined
		const status = createStatus({ id: 'sys-idle', label: 'Idle' })
		const self = {
			getSelectableStatuses: () => [status],
			getRunnableMacros: () => [],
			getCrewLanState: () => presetState(),
			setPresetDefinitions: (
				structure: CompanionPresetSection<ModuleSchema>[],
				presets: CompanionPresetDefinitions<ModuleSchema>,
			) => {
				capturedStructure = structure
				capturedPresets = presets
			},
		} as unknown as ModuleInstance

		UpdatePresets(self)

		assert.ok(capturedStructure)
		assert.ok(capturedPresets)
		assert.equal(capturedStructure[0]?.id, 'status')

		const preset = capturedPresets['status_sys-idle']
		assert.ok(preset)
		assert.equal(preset.name, 'Status: Standby')
		assert.equal(preset.style.bgcolor, offlineBackgroundColor)
		assert.equal(preset.style.color, offlineTextColor)
		assert.equal(preset.style.text, 'Standby')

		const [ready, feedback] = preset.feedbacks
		assert.equal(ready?.feedbackId, 'connection_ready')
		assert.equal(ready?.style?.bgcolor, 0x05420d)
		assert.equal(ready?.style?.color, 0x101820)
		assert.ok(feedback)
		assert.equal(feedback.feedbackId, 'status_is')
		assert.deepEqual(feedback.options, { statusId: 'sys-idle' })
		assert.ok(feedback.style)
		assert.equal(feedback.style.bgcolor, 0x0fcf29)
		assert.equal(feedback.style.color, 0x101820)
		assert.equal(feedback.style.text, 'Standby')
	})
})

function createMacro(input: Partial<PublicMacroDto>): PublicMacroDto {
	return {
		id: 'macro-showstart',
		label: 'Show Start',
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		running: false,
		runnable: true,
		sortOrder: 0,
		runStartedAt: null,
		updatedAt: null,
		...input,
	}
}

describe('Companion macro presets', () => {
	function build(macros: PublicMacroDto[]): {
		presets: CompanionPresetDefinitions<ModuleSchema>
		structure: CompanionPresetSection<ModuleSchema>[]
	} {
		let capturedPresets: CompanionPresetDefinitions<ModuleSchema> | undefined
		let capturedStructure: CompanionPresetSection<ModuleSchema>[] | undefined
		const self = {
			getSelectableStatuses: () => [],
			getRunnableMacros: () => macros,
			getCrewLanState: () => presetState(),
			setPresetDefinitions: (
				structure: CompanionPresetSection<ModuleSchema>[],
				presets: CompanionPresetDefinitions<ModuleSchema>,
			) => {
				capturedStructure = structure
				capturedPresets = presets
			},
		} as unknown as ModuleInstance

		UpdatePresets(self)
		assert.ok(capturedPresets)
		assert.ok(capturedStructure)

		return { presets: capturedPresets, structure: capturedStructure }
	}

	it('builds one dimmed button per macro that lights up while it runs', () => {
		const { presets, structure } = build([createMacro({})])
		const preset = presets['macro_macro-showstart']

		assert.ok(preset)
		assert.equal(preset.name, 'Macro: Show Start')
		assert.equal(preset.style.bgcolor, offlineBackgroundColor)
		assert.equal(preset.style.text, 'Show Start')

		const [step] = preset.steps
		assert.deepEqual(step?.down, [{ actionId: 'run_macro', options: { macroId: 'macro-showstart' } }])
		assert.deepEqual(step?.up, [])

		const [ready, feedback] = preset.feedbacks
		assert.equal(ready?.feedbackId, 'connection_ready')
		assert.equal(ready?.style?.bgcolor, 0x05420d)
		assert.equal(feedback?.feedbackId, 'macro_running')
		assert.deepEqual(feedback?.options, { macroId: 'macro-showstart' })
		assert.equal(feedback?.style?.bgcolor, 0x0fcf29)

		assert.equal(structure[0]?.id, 'macros')
	})

	it('offers no macro section when CrewLAN publishes no macros', () => {
		const { presets, structure } = build([])

		assert.equal(
			Object.keys(presets).some((id) => id.startsWith('macro_')),
			false,
		)
		assert.equal(
			structure.some((section) => section.id === 'macros'),
			false,
		)
	})
})

const crewGroupId = 'grp-0123456789abcdef0123456789abcdef'

function createIntercom(groups: { id: string; name: string }[]): CrewLanState['intercom'] {
	return {
		groups: groups.map((group) => ({
			...group,
			everyone: group.id === 'everyone',
			muted: false,
			gainDb: 0,
			talkHeld: false,
			talkKey: null,
		})),
		inputMuted: false,
		audioConnected: true,
		ringing: null,
		calling: null,
		call: null,
		callTalkHeld: false,
		callTalkKey: null,
	}
}

describe('Companion intercom presets', () => {
	function build(state: CrewLanState): {
		presets: CompanionPresetDefinitions<ModuleSchema>
		structure: CompanionPresetSection<ModuleSchema>[]
	} {
		let capturedPresets: CompanionPresetDefinitions<ModuleSchema> | undefined
		let capturedStructure: CompanionPresetSection<ModuleSchema>[] | undefined
		const self = {
			label: 'crewlan',
			getSelectableStatuses: () => [],
			getRunnableMacros: () => [],
			getCrewLanState: () => state,
			setPresetDefinitions: (
				structure: CompanionPresetSection<ModuleSchema>[],
				presets: CompanionPresetDefinitions<ModuleSchema>,
			) => {
				capturedStructure = structure
				capturedPresets = presets
			},
		} as unknown as ModuleInstance

		UpdatePresets(self)
		assert.ok(capturedPresets)
		assert.ok(capturedStructure)

		return { presets: capturedPresets, structure: capturedStructure }
	}

	function intercomPresetIds(structure: CompanionPresetSection<ModuleSchema>[]): string[][] {
		const section = structure.find((candidate) => candidate.id === 'intercom')
		assert.ok(section)

		return section.definitions.map((definition) =>
			typeof definition === 'string' ? [definition] : 'presets' in definition ? [...definition.presets] : [],
		)
	}

	it('offers Global Talk and Output alone over v1', () => {
		const { presets, structure } = build(presetState({ api: 'v1', intercom: null }))

		assert.deepEqual(intercomPresetIds(structure), [['talk_push', 'talk_latch_toggle', 'listen_mute_toggle']])
		assert.equal(presets.talk_push?.name, 'Global Talk (push)')
		assert.equal(presets.talk_latch_toggle?.name, 'Global Talk (latch)')
		assert.equal(presets.listen_mute_toggle?.name, 'Output Mute')
		assert.equal(presets.input_mute_toggle, undefined)
		assert.equal(presets.call_answer, undefined)
	})

	it('offers Input, a Talk and Mute per group, All first, and Direct over v2', () => {
		const { presets, structure } = build(
			presetState({
				api: 'v2',
				intercom: createIntercom([
					{ id: 'everyone', name: 'All' },
					{ id: crewGroupId, name: 'Crew' },
				]),
			}),
		)

		assert.deepEqual(intercomPresetIds(structure), [
			['talk_push', 'talk_latch_toggle', 'listen_mute_toggle', 'input_mute_toggle'],
			['group_everyone_talk_push', 'group_everyone_talk_latch', 'group_everyone_mute'],
			[`group_${crewGroupId}_talk_push`, `group_${crewGroupId}_talk_latch`, `group_${crewGroupId}_mute`],
			['call_answer', 'call_talk_push', 'call_talk_latch', 'call_hang_up'],
		])

		const section = structure.find((candidate) => candidate.id === 'intercom')
		assert.deepEqual(
			section?.definitions.map((definition) => (typeof definition === 'string' ? definition : definition.name)),
			['Global Talk, Output and Input', 'All', 'Crew', 'Direct'],
		)

		const push = presets[`group_${crewGroupId}_talk_push`]
		assert.equal(push?.name, 'Crew: Talk (push)')
		assert.equal(push?.style.text, 'Crew\nTalk Push')
		assert.deepEqual(push?.steps[0]?.down, [{ actionId: 'group_talk_push_down', options: { groupId: crewGroupId } }])
		assert.deepEqual(push?.steps[0]?.up, [{ actionId: 'group_talk_push_up', options: { groupId: crewGroupId } }])

		const latch = presets[`group_${crewGroupId}_talk_latch`]
		assert.deepEqual(latch?.steps[0]?.down, [
			{ actionId: 'group_talk_latch', options: { groupId: crewGroupId, mode: 'toggle' } },
		])

		const mute = presets[`group_${crewGroupId}_mute`]
		assert.equal(mute?.name, 'Crew: Mute')
		assert.deepEqual(mute?.steps[0]?.down, [
			{ actionId: 'group_mute', options: { groupId: crewGroupId, mode: 'toggle' } },
		])

		assert.equal(presets.call_answer?.style.text, 'Answer\n$(crewlan:intercom_ringing_caller)')
		assert.equal(presets.call_hang_up?.style.text, 'Hang up\n$(crewlan:intercom_call_partner)')
		assert.deepEqual(presets.call_hang_up?.steps[0]?.down, [{ actionId: 'call_hang_up', options: {} }])

		assert.equal(presets.call_talk_push?.name, 'Direct: Talk (push)')
		assert.equal(presets.call_talk_push?.style.text, 'Talk Push\n$(crewlan:intercom_call_partner)')
		assert.deepEqual(presets.call_talk_push?.steps[0]?.down, [{ actionId: 'call_talk_push_down', options: {} }])
		assert.deepEqual(presets.call_talk_push?.steps[0]?.up, [{ actionId: 'call_talk_push_up', options: {} }])
		assert.equal(presets.call_talk_latch?.name, 'Direct: Talk (latch)')
		assert.equal(presets.call_talk_latch?.style.text, 'Talk Latch\n$(crewlan:intercom_call_partner)')
		assert.deepEqual(presets.call_talk_latch?.steps[0]?.down, [
			{ actionId: 'call_talk_latch', options: { mode: 'toggle' } },
		])
		assert.deepEqual(presets.call_talk_latch?.steps[0]?.up, [])
	})

	it('drops a group left or removed and shows a rename at the next rebuild', () => {
		const joined = build(
			presetState({
				api: 'v2',
				intercom: createIntercom([
					{ id: 'everyone', name: 'All' },
					{ id: crewGroupId, name: 'Crew' },
				]),
			}),
		)
		assert.ok(joined.presets[`group_${crewGroupId}_mute`])

		const renamed = build(
			presetState({
				api: 'v2',
				intercom: createIntercom([
					{ id: 'everyone', name: 'All' },
					{ id: crewGroupId, name: 'Stage' },
				]),
			}),
		)
		assert.equal(renamed.presets[`group_${crewGroupId}_mute`]?.name, 'Stage: Mute')

		const left = build(presetState({ api: 'v2', intercom: createIntercom([{ id: 'everyone', name: 'All' }]) }))
		assert.equal(
			Object.keys(left.presets).some((id) => id.includes(crewGroupId)),
			false,
		)
		assert.equal(
			intercomPresetIds(left.structure)
				.flat()
				.some((id) => id.includes(crewGroupId)),
			false,
		)
	})

	it('ignores an intercom state while the connection speaks v1', () => {
		const { presets } = build(presetState({ api: 'v1', intercom: createIntercom([{ id: 'everyone', name: 'All' }]) }))

		assert.equal(presets.group_everyone_mute, undefined)
		assert.equal(presets.input_mute_toggle, undefined)
	})

	it('gives every preset the offline base, the ordinary look first, the state, then the grey again while not ready', () => {
		const { presets } = build(presetState({ api: 'v2', intercom: createIntercom([{ id: 'everyone', name: 'All' }]) }))
		const expectedFirst: Record<string, string> = {
			talk_push: 'talk_available',
			talk_latch_toggle: 'talk_available',
			listen_mute_toggle: 'connection_ready',
			input_mute_toggle: 'connection_ready',
			group_everyone_talk_push: 'group_talk_available',
			group_everyone_talk_latch: 'group_talk_available',
			group_everyone_mute: 'group_member',
			call_answer: 'answer_available',
			call_talk_push: 'call_talk_available',
			call_talk_latch: 'call_talk_available',
			call_hang_up: 'connection_ready',
			dismiss_alerts: 'connection_ready',
		}
		const expectedStates: Record<string, string[]> = {
			talk_push: ['talk_push_active'],
			talk_latch_toggle: ['talk_latch_active'],
			listen_mute_toggle: ['listen_muted'],
			input_mute_toggle: ['input_muted'],
			group_everyone_talk_push: ['group_talk_active'],
			group_everyone_talk_latch: ['group_talk_active'],
			group_everyone_mute: ['group_muted'],
			call_answer: ['call_ringing'],
			call_talk_push: ['call_talk_active'],
			call_talk_latch: ['call_talk_active'],
			// Lit while there is something to hang up: the participant's own call ringing, or the active call.
			call_hang_up: ['call_calling', 'call_active'],
			dismiss_alerts: [],
		}

		assert.deepEqual(Object.keys(presets).sort(), Object.keys(expectedFirst).sort())

		for (const [id, preset] of Object.entries(presets)) {
			assert.ok(preset, id)
			assert.equal(preset.style.bgcolor, offlineBackgroundColor, id)
			assert.equal(preset.style.color, offlineTextColor, id)
			assert.equal(preset.previewStyle?.text, preset.style.text, id)
			assert.notEqual(preset.previewStyle?.bgcolor, offlineBackgroundColor, id)

			// The Global Talk keys grey on the owner's absence too, which v1's availability does not say.
			const trailing = id.startsWith('talk_') ? [expectedFirst[id], 'connection_ready'] : [expectedFirst[id]]
			const states = preset.feedbacks.slice(1, preset.feedbacks.length - trailing.length)
			const last = preset.feedbacks.slice(preset.feedbacks.length - trailing.length)
			const [first] = preset.feedbacks
			assert.equal(first?.feedbackId, expectedFirst[id], id)
			assert.equal(first?.style?.text, preset.style.text, id)
			assert.notEqual(first?.style?.bgcolor, offlineBackgroundColor, id)
			assert.deepEqual(
				states.map((feedback) => feedback.feedbackId),
				expectedStates[id],
				id,
			)
			assert.deepEqual(
				last.map((feedback) => [feedback.feedbackId, feedback.isInverted, feedback.style]),
				trailing.map((feedbackId) => [feedbackId, true, { color: offlineTextColor, bgcolor: offlineBackgroundColor }]),
				id,
			)
			assert.deepEqual(last[0]?.options, first?.options, id)
		}
	})

	it('names no Shoutbox in any shown text', () => {
		const { presets, structure } = build(
			presetState({ api: 'v2', intercom: createIntercom([{ id: 'everyone', name: 'All' }]) }),
		)

		assert.doesNotMatch(JSON.stringify({ presets, structure }), /shoutbox/iu)
	})
})
