import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanionButtonStyleProps, CompanionPresetDefinitions } from '@companion-module/base'
import type ModuleInstance from '../src/main.js'
import type { ModuleSchema } from '../src/main.js'
import { offlineBackgroundColor, offlineTextColor } from '../src/button-style.js'
import { UpdateFeedbacks } from '../src/feedbacks.js'
import { UpdatePresets } from '../src/presets.js'
import type { CrewLanApiVersion, CrewLanState, PublicStatusDto } from '../src/types.js'

const crewGroupId = 'grp-0123456789abcdef0123456789abcdef'

const green: PublicStatusDto = {
	id: 'sys-green',
	kind: 'system',
	label: 'Ready',
	paletteKey: 'green',
	colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
	alertType: null,
	motionPreset: 'none',
	selectable: true,
}

const offline: PublicStatusDto = {
	...green,
	id: 'sys-offline',
	label: 'Offline',
	colors: { backgroundColor: '#555555', foregroundColor: '#ffffff' },
	selectable: false,
}

/** A connection with every state lit: the status chosen, the macro running, every mute on, a call. */
function litState(api: CrewLanApiVersion): CrewLanState {
	return {
		connected: true,
		streamConnected: true,
		entityId: 'ent-1',
		workspace: null,
		entity: null,
		statuses: [green],
		macros: [
			{
				id: 'macro-show',
				label: 'Show',
				colors: { backgroundColor: '#ff00ff', foregroundColor: '#ffffff' },
				running: true,
				runnable: true,
				sortOrder: 0,
				runStartedAt: null,
				updatedAt: null,
			},
		],
		macrosSupported: true,
		status: { entityId: 'ent-1', selectedStatusId: 'sys-green', status: green },
		controls: {
			entityId: 'ent-1',
			shoutbox: {
				listen: { enabled: true, muted: true, available: true },
				talk: { enabled: true, active: true, live: true, controlMode: 'push', available: true },
			},
		},
		lastAlert: '',
		lastError: '',
		api,
		ownerPresent: true,
		intercom:
			api === 'v1'
				? null
				: {
						groups: [
							{ id: 'everyone', name: 'All', everyone: true, muted: true, gainDb: 0, talkHeld: true, talkKey: 'push' },
							{
								id: crewGroupId,
								name: 'Crew',
								everyone: false,
								muted: true,
								gainDb: 0,
								talkHeld: true,
								talkKey: 'latch',
							},
						],
						inputMuted: true,
						audioConnected: true,
						ringing: [{ id: 'ent-2', name: 'Anna' }],
						call: null,
					},
	}
}

type Definitions = Record<string, { callback: (feedback: { options: Record<string, unknown> }) => unknown }>

/** The module's feedbacks and presets, built once against `state`, which a test then changes. */
function harness(state: CrewLanState): {
	definitions: Definitions
	presets: CompanionPresetDefinitions<ModuleSchema>
} {
	let definitions: Definitions | undefined
	let presets: CompanionPresetDefinitions<ModuleSchema> | undefined
	const self = {
		label: 'crewlan',
		getCrewLanState: () => state,
		getStatusChoices: () => [],
		getDefaultStatusChoice: () => '',
		getMacroChoices: () => [],
		getDefaultMacroChoice: () => '',
		isMacroRunning: (macroId: string) => state.macros.some((macro) => macro.id === macroId && macro.running),
		getSelectableStatuses: () => state.statuses.filter((status) => status.selectable),
		getRunnableMacros: () => state.macros.filter((macro) => macro.runnable),
		setFeedbackDefinitions: (captured: Definitions) => {
			definitions = captured
		},
		setPresetDefinitions: (_structure: unknown, captured: CompanionPresetDefinitions<ModuleSchema>) => {
			presets = captured
		},
	} as unknown as ModuleInstance

	UpdateFeedbacks(self)
	UpdatePresets(self)
	assert.ok(definitions)
	assert.ok(presets)

	return { definitions, presets }
}

/**
 * A placed button's final look as Companion paints it: the base style, then each boolean feedback
 * in order, its value inverted where the feedback says so, a true one painting over the ones before.
 */
function looks(built: ReturnType<typeof harness>): Record<string, Partial<CompanionButtonStyleProps>> {
	const result: Record<string, Partial<CompanionButtonStyleProps>> = {}

	for (const [id, preset] of Object.entries(built.presets)) {
		assert.ok(preset && preset.type === 'simple', id)
		let style: Partial<CompanionButtonStyleProps> = { ...preset.style }

		for (const feedback of preset.feedbacks) {
			const definition = built.definitions[feedback.feedbackId]
			assert.ok(definition, feedback.feedbackId)
			const value = definition.callback({ options: feedback.options }) === true

			if (value !== (feedback.isInverted === true)) {
				style = { ...style, ...feedback.style }
			}
		}

		result[id] = style
	}

	return result
}

function isGrey(style: Partial<CompanionButtonStyleProps> | undefined): boolean {
	return style?.bgcolor === offlineBackgroundColor && style.color === offlineTextColor
}

const v1Presets = [
	'status_sys-green',
	'macro_macro-show',
	'talk_push',
	'talk_latch_toggle',
	'listen_mute_toggle',
	'dismiss_alerts',
]
const groupPresets = (groupId: string) => [
	`group_${groupId}_talk_push`,
	`group_${groupId}_talk_latch`,
	`group_${groupId}_mute`,
]
const v2Presets = [
	...v1Presets,
	'input_mute_toggle',
	...groupPresets('everyone'),
	...groupPresets(crewGroupId),
	'call_answer',
	'call_hang_up',
]

for (const api of ['v1', 'v2'] as const) {
	describe(`every preset's final look over ${api}`, () => {
		const expected = api === 'v1' ? v1Presets : v2Presets

		it('offers exactly the presets of its API', () => {
			assert.deepEqual(Object.keys(harness(litState(api)).presets).sort(), [...expected].sort())
		})

		it('is lit, never grey, while ready', () => {
			const state = litState(api)
			const built = harness(state)

			for (const [id, style] of Object.entries(looks(built))) {
				assert.equal(isGrey(style), false, id)
			}
		})

		it('is grey on every preset while the owner is absent, whatever its state feedbacks say', () => {
			const state = litState(api)
			const built = harness(state)
			// CrewLAN shows the Entity offline and keeps what it chose for when it comes back.
			state.status = { entityId: 'ent-1', selectedStatusId: 'sys-green', status: offline }
			state.ownerPresent = false

			for (const [id, style] of Object.entries(looks(built))) {
				assert.equal(isGrey(style), true, id)
			}
		})

		it('is grey on every preset while disconnected', () => {
			const state = litState(api)
			const built = harness(state)
			state.connected = false

			for (const [id, style] of Object.entries(looks(built))) {
				assert.equal(isGrey(style), true, id)
			}
		})
	})
}

describe('the final look over v2 in the intercom', () => {
	it('greys the placed Talk and Mute keys of a group the participant left, and only those', () => {
		const state = litState('v2')
		const built = harness(state)
		assert.ok(state.intercom)
		state.intercom.groups = state.intercom.groups.filter((group) => group.id === 'everyone')
		const final = looks(built)

		for (const id of v2Presets) {
			assert.equal(isGrey(final[id]), groupPresets(crewGroupId).includes(id), id)
		}
	})

	it('greys Answer while a call is up, even while somebody rings', () => {
		const state = litState('v2')
		const built = harness(state)
		assert.ok(state.intercom)
		state.intercom.call = { id: 'ent-3', name: 'Ben' }
		const final = looks(built)

		assert.equal(isGrey(final.call_answer), true)
		assert.equal(isGrey(final.call_hang_up), false)
	})

	it('greys the talk keys and Answer without an audio connection', () => {
		const state = litState('v2')
		const built = harness(state)
		assert.ok(state.intercom && state.controls)
		state.intercom.audioConnected = false
		state.controls.shoutbox.talk.available = false
		const final = looks(built)

		for (const id of [
			'talk_push',
			'talk_latch_toggle',
			'call_answer',
			`group_everyone_talk_push`,
			`group_everyone_talk_latch`,
		]) {
			assert.equal(isGrey(final[id]), true, id)
		}

		assert.equal(isGrey(final.group_everyone_mute), false)
	})
})
