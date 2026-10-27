import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanionButtonStyleProps, CompanionPresetDefinitions } from '@companion-module/base'
import type ModuleInstance from '../src/main.js'
import type { ModuleSchema } from '../src/main.js'
import { actionRequests } from '../src/actions.js'
import { wireRequests } from '../src/api-v2.js'
import { offlineBackgroundColor, offlineTextColor } from '../src/button-style.js'
import { isOffered, UpdateFeedbacks } from '../src/feedbacks.js'
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

/**
 * A connection with every state lit: the status chosen, the macro running, every mute on, somebody
 * ringing and a call active with its Talk held — the last two at once, which CrewLAN never reports,
 * so that every Direct key is lit.
 */
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
		targetKind: null,
		requests: null,
		indicators: [],
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
						ringing: { id: 'ent-2', name: 'Anna' },
						calling: null,
						call: { id: 'ent-3', name: 'Ben' },
						callTalkHeld: true,
						callTalkKey: 'latch',
					},
	}
}

type Definitions = Record<
	string,
	{ callback: (feedback: { options: Record<string, unknown>; controlId?: string }) => unknown }
>

/**
 * The module's feedbacks and presets, built once against `state`, which a test then changes. Each
 * preset is placed as the control named by its id, holding the actions of its steps, as Companion
 * reports them to the module.
 */
function harness(state: CrewLanState): {
	definitions: Definitions
	presets: CompanionPresetDefinitions<ModuleSchema>
} {
	let definitions: Definitions | undefined
	let presets: CompanionPresetDefinitions<ModuleSchema> | undefined
	const self = {
		label: 'crewlan',
		getCrewLanState: () => state,
		isControlOffered: (controlId: string | undefined) => {
			const preset = controlId === undefined ? undefined : presets?.[controlId]
			const actions = preset?.type === 'simple' ? preset.steps.flatMap((step) => [...step.down, ...step.up]) : []

			return actions.every((action) => actionRequests[action.actionId].every((wireId) => isOffered(state, wireId)))
		},
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
			const value = definition.callback({ options: feedback.options, controlId: id }) === true

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
	'call_talk_push',
	'call_talk_latch',
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

	it('lights Answer while somebody rings, the Direct Talk keys during an active call, Hang up for either call', () => {
		const state = litState('v2')
		const built = harness(state)
		assert.ok(state.intercom)
		const direct = (): unknown[] => {
			const final = looks(built)

			return ['call_answer', 'call_talk_push', 'call_talk_latch', 'call_hang_up'].map((id) =>
				isGrey(final[id]) ? 'grey' : final[id]?.bgcolor,
			)
		}

		state.intercom.call = null
		state.intercom.callTalkHeld = false
		state.intercom.callTalkKey = null
		assert.deepEqual(direct(), [0xff9800, 'grey', 'grey', 0x4a4a4a])

		state.intercom.ringing = null
		state.intercom.calling = { id: 'ent-2', name: 'Anna' }
		assert.deepEqual(direct(), ['grey', 'grey', 'grey', 0xff9800])

		state.intercom.calling = null
		state.intercom.call = { id: 'ent-2', name: 'Anna' }
		assert.deepEqual(direct(), ['grey', 0x3a7542, 0x3a7542, 0x0fcf29])

		state.intercom.callTalkHeld = true
		state.intercom.callTalkKey = 'push'
		assert.deepEqual(direct(), ['grey', 0x0fcf29, 0x0fcf29, 0x0fcf29])

		state.intercom.call = null
		state.intercom.callTalkHeld = false
		state.intercom.callTalkKey = null
		assert.deepEqual(direct(), ['grey', 'grey', 'grey', 0x4a4a4a])
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
			'call_talk_push',
			'call_talk_latch',
			`group_everyone_talk_push`,
			`group_everyone_talk_latch`,
		]) {
			assert.equal(isGrey(final[id]), true, id)
		}

		assert.equal(isGrey(final.group_everyone_mute), false)
	})
})

describe('the final look over v2 as the offer says', () => {
	const indicatorId = 'ind-0123456789abcdef0123456789abcdef'
	const indicatorPreset = `indicator_${indicatorId}_sys-green`
	const everyRequest = Object.values(wireRequests)

	it('greys every placed key whose request leaves the offer, and only those', () => {
		const state = litState('v2')
		state.requests = everyRequest
		const built = harness(state)
		state.requests = everyRequest.filter((wireId) => wireId !== wireRequests.setControls)
		const final = looks(built)
		const lit = [
			'status_sys-green',
			'macro_macro-show',
			'dismiss_alerts',
			...v2Presets.filter((id) => id.endsWith('_mute')),
		]

		for (const id of v2Presets) {
			assert.equal(isGrey(final[id]), !lit.includes(id), id)
		}
	})

	it("lights an indicator's key at its status, dims it at another, and greys it where the offer withdrew it", () => {
		const state = litState('v2')
		state.requests = everyRequest
		state.indicators = [{ id: indicatorId, name: 'Stage door', statusIds: ['sys-green'], statusId: 'sys-green' }]
		const built = harness(state)
		const preset = built.presets[indicatorPreset]
		assert.ok(preset)
		assert.equal(preset.style.text, 'Stage door\nReady')

		assert.equal(looks(built)[indicatorPreset]?.bgcolor, 0x0fcf29)
		state.indicators = [{ ...state.indicators[0]!, statusId: 'sys-yellow' }]
		assert.equal(isGrey(looks(built)[indicatorPreset]), false)
		assert.notEqual(looks(built)[indicatorPreset]?.bgcolor, 0x0fcf29)
		state.indicators = [{ ...state.indicators[0]!, statusIds: [] }]
		assert.equal(isGrey(looks(built)[indicatorPreset]), true)
		state.indicators = []
		assert.equal(isGrey(looks(built)[indicatorPreset]), true)
		state.indicators = [{ id: indicatorId, name: 'Stage door', statusIds: ['sys-green'], statusId: null }]
		state.ownerPresent = false
		assert.equal(isGrey(looks(built)[indicatorPreset]), true)
	})

	it('offers a connection acting for a status indicator its keys alone', () => {
		const state = litState('v2')
		state.targetKind = 'indicator'
		state.requests = [wireRequests.setIndicatorStatus, 'status.query.listStatuses']
		state.indicators = [{ id: indicatorId, name: 'Stage door', statusIds: ['sys-green'], statusId: 'sys-green' }]
		state.macros = []
		state.intercom = null
		state.controls = null

		assert.deepEqual(Object.keys(harness(state).presets), [indicatorPreset])
	})
})
