import type {
	CompanionButtonStyleProps,
	CompanionPresetDefinitions,
	CompanionPresetSection,
	CompanionSimplePresetDefinition,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { getCompanionMacroButtonStyle, getCompanionStatusButtonStyle, getOfflineButtonStyle } from './button-style.js'

type Preset = CompanionSimplePresetDefinition<ModuleSchema>
type PresetFeedback = Preset['feedbacks'][number]

const presetFontSize = 14
const talkActiveColor = 0x0fcf29
const talkInactiveColor = 0x3a7542
const listenUnmutedColor = 0x6b3535
const listenMutedColor = 0xcf2929
const callIdleColor = 0x4a4a4a
const callRingingColor = 0xff9800
const callActiveColor = 0x0fcf29

function keyStyle(text: string, color: number, bgcolor: number): CompanionButtonStyleProps {
	return { text, size: presetFontSize, color, bgcolor, show_topbar: false }
}

/**
 * One preset in the module's grey look. Companion paints a button's feedback styles in order, a
 * later one over an earlier one: the base style is the offline style, the first feedback paints the
 * ordinary style while `ready` holds, the state feedbacks follow, and last come `ready` and each of
 * `alsoReady` inverted with the offline colours, so a key that is not ready stays grey whatever its
 * state feedbacks say. A disabled connection's feedback values are cleared and read false before
 * the inversion, so its buttons show the offline base alone.
 */
function greyedPreset(input: {
	name: string
	style: CompanionButtonStyleProps
	ready: PresetFeedback
	alsoReady?: PresetFeedback[]
	states: PresetFeedback[]
	steps: Preset['steps']
}): Preset {
	const offline = getOfflineButtonStyle(input.style.text)
	// Every readiness feedback is boolean, which the schema's union cannot see through a spread.
	const notReady = [input.ready, ...(input.alsoReady ?? [])].map(
		(feedback) =>
			({
				...feedback,
				isInverted: true,
				style: { color: offline.color, bgcolor: offline.bgcolor },
			}) as PresetFeedback,
	)

	return {
		type: 'simple',
		name: input.name,
		style: offline,
		// Companion's preset list shows the preview, so a user picks a key by its ordinary look.
		previewStyle: input.style,
		steps: input.steps,
		feedbacks: [input.ready, ...input.states, ...notReady],
	}
}

function connectionReady(style: CompanionButtonStyleProps): PresetFeedback {
	return { feedbackId: 'connection_ready', options: {}, style }
}

// v1's talk availability says nothing of the owner's presence, so the Global Talk keys grey on both.
const globalTalkAlsoReady: PresetFeedback[] = [{ feedbackId: 'connection_ready', options: {}, style: {} }]

export function UpdatePresets(self: ModuleInstance): void {
	const selectableStatuses = self.getSelectableStatuses()
	const state = self.getCrewLanState()
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	// The "status_"/"macro_"/"group_" prefixes keep the generated ids apart from each other and from
	// the fixed ids below, whatever CrewLAN names a status, a macro or a group.
	const statusPresetIds: string[] = []
	const macroPresetIds: string[] = []

	for (const status of selectableStatuses) {
		const inactiveStyle = getCompanionStatusButtonStyle(status, false)
		const activeStyle = getCompanionStatusButtonStyle(status, true)
		const presetId = `status_${status.id}`

		statusPresetIds.push(presetId)
		presets[presetId] = greyedPreset({
			name: `Status: ${inactiveStyle.text}`,
			style: inactiveStyle,
			ready: connectionReady(inactiveStyle),
			states: [{ feedbackId: 'status_is', options: { statusId: status.id }, style: activeStyle }],
			steps: [{ down: [{ actionId: 'set_status', options: { statusId: status.id } }], up: [] }],
		})
	}

	for (const macro of self.getRunnableMacros()) {
		const idleStyle = getCompanionMacroButtonStyle(macro, false)
		const runningStyle = getCompanionMacroButtonStyle(macro, true)
		const presetId = `macro_${macro.id}`

		macroPresetIds.push(presetId)
		presets[presetId] = greyedPreset({
			name: `Macro: ${macro.label}`,
			style: idleStyle,
			ready: connectionReady(idleStyle),
			states: [{ feedbackId: 'macro_running', options: { macroId: macro.id }, style: runningStyle }],
			steps: [{ down: [{ actionId: 'run_macro', options: { macroId: macro.id } }], up: [] }],
		})
	}

	// The fixed ids keep their 1.x names: a placed button does not refer to its preset.
	const talkPushStyle = keyStyle('Global Talk\nPush', 0xffffff, talkInactiveColor)
	presets.talk_push = greyedPreset({
		name: 'Global Talk (push)',
		style: talkPushStyle,
		ready: { feedbackId: 'talk_available', options: {}, style: talkPushStyle },
		alsoReady: globalTalkAlsoReady,
		states: [
			{
				feedbackId: 'talk_push_active',
				options: {},
				style: keyStyle('Global Talk\nPush', 0x000000, talkActiveColor),
			},
		],
		steps: [
			{
				down: [{ actionId: 'talk_push_down', options: {} }],
				up: [{ actionId: 'talk_push_up', options: {} }],
			},
		],
	})

	const talkLatchStyle = keyStyle('Global Talk\nLatch', 0xffffff, talkInactiveColor)
	presets.talk_latch_toggle = greyedPreset({
		name: 'Global Talk (latch)',
		style: talkLatchStyle,
		ready: { feedbackId: 'talk_available', options: {}, style: talkLatchStyle },
		alsoReady: globalTalkAlsoReady,
		states: [
			{
				feedbackId: 'talk_latch_active',
				options: {},
				style: keyStyle('Global Talk\nLatch', 0x000000, talkActiveColor),
			},
		],
		steps: [{ down: [{ actionId: 'talk_latch', options: { mode: 'toggle' } }], up: [] }],
	})

	const outputStyle = keyStyle('Output\nMute', 0xffffff, listenUnmutedColor)
	presets.listen_mute_toggle = greyedPreset({
		name: 'Output Mute',
		style: outputStyle,
		ready: connectionReady(outputStyle),
		states: [{ feedbackId: 'listen_muted', options: {}, style: keyStyle('Output\nMute', 0xffffff, listenMutedColor) }],
		steps: [{ down: [{ actionId: 'listen_mute', options: { mode: 'toggle' } }], up: [] }],
	})

	const intercomPresetIds = ['talk_push', 'talk_latch_toggle', 'listen_mute_toggle']
	const groupDefinitions: { id: string; type: 'simple'; name: string; presets: string[] }[] = []
	// Over v1 (or before the first read) the section holds v1's one Talk and Mute alone.
	const intercom = state.api === 'v2' ? state.intercom : null

	if (intercom !== null) {
		const inputStyle = keyStyle('Input\nMute', 0xffffff, listenUnmutedColor)
		presets.input_mute_toggle = greyedPreset({
			name: 'Input Mute',
			style: inputStyle,
			ready: connectionReady(inputStyle),
			states: [{ feedbackId: 'input_muted', options: {}, style: keyStyle('Input\nMute', 0xffffff, listenMutedColor) }],
			steps: [{ down: [{ actionId: 'input_mute', options: { mode: 'toggle' } }], up: [] }],
		})
		intercomPresetIds.push('input_mute_toggle')

		// The groups arrive the Everyone group ("All") first; a group left or removed is simply absent
		// here, so its presets go with the next rebuild.
		for (const group of intercom.groups) {
			const groupId = group.id
			const pushId = `group_${groupId}_talk_push`
			const latchId = `group_${groupId}_talk_latch`
			const muteId = `group_${groupId}_mute`
			const available: PresetFeedback = {
				feedbackId: 'group_talk_available',
				options: { groupId },
				style: keyStyle(`${group.name}\nTalk Push`, 0xffffff, talkInactiveColor),
			}

			presets[pushId] = greyedPreset({
				name: `${group.name}: Talk (push)`,
				style: keyStyle(`${group.name}\nTalk Push`, 0xffffff, talkInactiveColor),
				ready: available,
				states: [
					{
						feedbackId: 'group_talk_active',
						options: { groupId },
						style: keyStyle(`${group.name}\nTalk Push`, 0x000000, talkActiveColor),
					},
				],
				steps: [
					{
						down: [{ actionId: 'group_talk_push_down', options: { groupId } }],
						up: [{ actionId: 'group_talk_push_up', options: { groupId } }],
					},
				],
			})

			presets[latchId] = greyedPreset({
				name: `${group.name}: Talk (latch)`,
				style: keyStyle(`${group.name}\nTalk Latch`, 0xffffff, talkInactiveColor),
				ready: { ...available, style: keyStyle(`${group.name}\nTalk Latch`, 0xffffff, talkInactiveColor) },
				states: [
					{
						feedbackId: 'group_talk_active',
						options: { groupId },
						style: keyStyle(`${group.name}\nTalk Latch`, 0x000000, talkActiveColor),
					},
				],
				steps: [{ down: [{ actionId: 'group_talk_latch', options: { groupId, mode: 'toggle' } }], up: [] }],
			})

			const muteStyle = keyStyle(`${group.name}\nMute`, 0xffffff, listenUnmutedColor)
			presets[muteId] = greyedPreset({
				name: `${group.name}: Mute`,
				style: muteStyle,
				// A group left or removed greys its Mute too, as its Talk keys.
				ready: { feedbackId: 'group_member', options: { groupId }, style: muteStyle },
				states: [
					{
						feedbackId: 'group_muted',
						options: { groupId },
						style: keyStyle(`${group.name}\nMute`, 0xffffff, listenMutedColor),
					},
				],
				steps: [{ down: [{ actionId: 'group_mute', options: { groupId, mode: 'toggle' } }], up: [] }],
			})

			groupDefinitions.push({
				id: `intercom-group-${groupId}`,
				type: 'simple',
				name: group.name,
				presets: [pushId, latchId, muteId],
			})
		}

		// The caller's name comes through a variable, so the key names whoever rings at that moment.
		const answerText = `Answer\n$(${self.label}:intercom_ringing_caller)`
		const answerStyle = keyStyle(answerText, 0xffffff, callIdleColor)
		presets.call_answer = greyedPreset({
			name: 'Direct: Answer',
			style: answerStyle,
			ready: { feedbackId: 'answer_available', options: {}, style: answerStyle },
			states: [{ feedbackId: 'call_ringing', options: {}, style: keyStyle(answerText, 0x000000, callRingingColor) }],
			steps: [{ down: [{ actionId: 'call_answer', options: {} }], up: [] }],
		})

		const hangUpText = `Hang up\n$(${self.label}:intercom_call_partner)`
		const hangUpStyle = keyStyle(hangUpText, 0xffffff, callIdleColor)
		presets.call_hang_up = greyedPreset({
			name: 'Direct: Hang up',
			style: hangUpStyle,
			ready: connectionReady(hangUpStyle),
			states: [{ feedbackId: 'call_active', options: {}, style: keyStyle(hangUpText, 0x000000, callActiveColor) }],
			steps: [{ down: [{ actionId: 'call_hang_up', options: {} }], up: [] }],
		})
	}

	const dismissStyle = keyStyle('Dismiss\nAlerts', 0x000000, 0xffffff)
	presets.dismiss_alerts = greyedPreset({
		name: 'Dismiss Alerts',
		style: dismissStyle,
		ready: connectionReady(dismissStyle),
		states: [],
		steps: [{ down: [{ actionId: 'dismiss_alerts', options: {} }], up: [] }],
	})

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		...(statusPresetIds.length > 0
			? [
					{
						id: 'status',
						name: 'Status',
						definitions: [
							{
								id: 'status-buttons',
								type: 'simple' as const,
								name: 'Status Buttons',
								presets: statusPresetIds,
							},
						],
					},
				]
			: []),
		...(macroPresetIds.length > 0
			? [
					{
						id: 'macros',
						name: 'Macros',
						definitions: [
							{
								id: 'macro-buttons',
								type: 'simple' as const,
								name: 'Macro Buttons',
								presets: macroPresetIds,
							},
						],
					},
				]
			: []),
		{
			id: 'intercom',
			name: 'Intercom',
			definitions: [
				{
					id: 'intercom-controls',
					type: 'simple',
					name: intercom === null ? 'Global Talk and Output' : 'Global Talk, Output and Input',
					presets: intercomPresetIds,
				},
				...groupDefinitions,
				...(intercom === null
					? []
					: [
							{
								id: 'intercom-direct',
								type: 'simple' as const,
								name: 'Direct',
								presets: ['call_answer', 'call_hang_up'],
							},
						]),
			],
		},
		{
			id: 'alerts',
			name: 'Alerts',
			definitions: [
				{
					id: 'alert-actions',
					type: 'simple',
					name: 'Alert Actions',
					presets: ['dismiss_alerts'],
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
