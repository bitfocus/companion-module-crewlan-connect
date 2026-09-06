import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { getCompanionMacroButtonStyle, getCompanionStatusButtonStyle } from './button-style.js'

const presetFontSize = 14
const talkActiveColor = 0x0fcf29
const talkInactiveColor = 0x3a7542
const listenUnmutedColor = 0x6b3535
const listenMutedColor = 0xcf2929

export function UpdatePresets(self: ModuleInstance): void {
	const selectableStatuses = self.getSelectableStatuses()
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	// The "status_"/"macro_" prefixes keep the generated ids apart from each other and from the
	// fixed ids below, whatever CrewLAN names a status or a macro.
	const statusPresetIds: string[] = []
	const macroPresetIds: string[] = []

	for (const status of selectableStatuses) {
		const inactiveStyle = getCompanionStatusButtonStyle(status, false)
		const activeStyle = getCompanionStatusButtonStyle(status, true)
		const presetId = `status_${status.id}`

		statusPresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: `Status: ${inactiveStyle.text}`,
			style: inactiveStyle,
			steps: [
				{
					down: [{ actionId: 'set_status', options: { statusId: status.id } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'status_is',
					options: { statusId: status.id },
					style: activeStyle,
				},
			],
		}
	}

	for (const macro of self.getRunnableMacros()) {
		const idleStyle = getCompanionMacroButtonStyle(macro, false)
		const runningStyle = getCompanionMacroButtonStyle(macro, true)
		const presetId = `macro_${macro.id}`

		macroPresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: `Macro: ${macro.label}`,
			style: idleStyle,
			steps: [
				{
					down: [{ actionId: 'run_macro', options: { macroId: macro.id } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'macro_running',
					options: { macroId: macro.id },
					style: runningStyle,
				},
			],
		}
	}

	presets.listen_mute_toggle = {
		type: 'simple',
		name: 'Listen Mute Toggle',
		style: {
			text: 'Listen\nMute',
			size: presetFontSize,
			color: 0xffffff,
			bgcolor: listenUnmutedColor,
			show_topbar: false,
		},
		steps: [
			{
				down: [{ actionId: 'listen_mute', options: { mode: 'toggle' } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'listen_muted',
				options: {},
				style: {
					text: 'Listen\nMute',
					size: presetFontSize,
					color: 0xffffff,
					bgcolor: listenMutedColor,
					show_topbar: false,
				},
			},
		],
	}

	presets.talk_push = {
		type: 'simple',
		name: 'Talk Push',
		style: {
			text: 'Talk\nPush',
			size: presetFontSize,
			color: 0xffffff,
			bgcolor: talkInactiveColor,
			show_topbar: false,
		},
		steps: [
			{
				down: [{ actionId: 'talk_push_down', options: {} }],
				up: [{ actionId: 'talk_push_up', options: {} }],
			},
		],
		feedbacks: [
			{
				feedbackId: 'talk_push_active',
				options: {},
				style: {
					text: 'Talk\nPush',
					size: presetFontSize,
					color: 0x000000,
					bgcolor: talkActiveColor,
					show_topbar: false,
				},
			},
		],
	}

	presets.talk_latch_toggle = {
		type: 'simple',
		name: 'Talk Latch',
		style: {
			text: 'Talk\nLatch',
			size: presetFontSize,
			color: 0xffffff,
			bgcolor: talkInactiveColor,
			show_topbar: false,
		},
		steps: [
			{
				down: [{ actionId: 'talk_latch', options: { mode: 'toggle' } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'talk_latch_active',
				options: {},
				style: {
					text: 'Talk\nLatch',
					size: presetFontSize,
					color: 0x000000,
					bgcolor: talkActiveColor,
					show_topbar: false,
				},
			},
		],
	}

	presets.dismiss_alerts = {
		type: 'simple',
		name: 'Dismiss Alerts',
		style: {
			text: 'Dismiss\nAlerts',
			size: presetFontSize,
			color: 0x000000,
			bgcolor: 0xffffff,
			show_topbar: false,
		},
		steps: [
			{
				down: [{ actionId: 'dismiss_alerts', options: {} }],
				up: [],
			},
		],
		feedbacks: [],
	}

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
			id: 'shoutbox',
			name: 'Shoutbox',
			definitions: [
				{
					id: 'shoutbox-controls',
					type: 'simple',
					name: 'Live Controls',
					presets: ['listen_mute_toggle', 'talk_push', 'talk_latch_toggle'],
				},
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
