import type {
	CompanionActionDefinitions,
	CompanionActionInfo,
	CompanionInputFieldDropdown,
} from '@companion-module/base'
import { wireRequests } from './api-v2.js'
import { macroIdRegex, statusIdRegex } from './config.js'
import type ModuleInstance from './main.js'

type MuteMode = 'toggle' | 'on' | 'off'
type LatchMode = 'toggle' | 'on' | 'off'

export type ActionsSchema = {
	set_status: {
		options: {
			statusId: string
		}
	}
	listen_mute: {
		options: {
			mode: MuteMode
		}
	}
	talk_push_down: {
		options: Record<string, never>
	}
	talk_push_up: {
		options: Record<string, never>
	}
	talk_latch: {
		options: {
			mode: LatchMode
		}
	}
	dismiss_alerts: {
		options: Record<string, never>
	}
	refresh: {
		options: Record<string, never>
	}
	run_macro: {
		options: {
			macroId: string
		}
	}
	input_mute: {
		options: {
			mode: MuteMode
		}
	}
	group_talk_push_down: {
		options: {
			groupId: string
		}
	}
	group_talk_push_up: {
		options: {
			groupId: string
		}
	}
	group_talk_latch: {
		options: {
			groupId: string
			mode: LatchMode
		}
	}
	group_mute: {
		options: {
			groupId: string
			mode: MuteMode
		}
	}
	call_answer: {
		options: Record<string, never>
	}
	call_talk_push_down: {
		options: Record<string, never>
	}
	call_talk_push_up: {
		options: Record<string, never>
	}
	call_talk_latch: {
		options: {
			mode: LatchMode
		}
	}
	call_hang_up: {
		options: Record<string, never>
	}
	set_indicator_status: {
		options: {
			indicatorId: string
			statusId: string
		}
	}
}

/**
 * The `/api/v2` request each action sends. A button holding an action whose request the
 * connection's offer does not hold now reads not ready, so its readiness feedback greys it; the
 * action itself is refused before anything is sent. *Refresh* sends none. Over v1, which says no
 * offer, every button reads ready as before.
 */
export const actionRequests: Readonly<Record<keyof ActionsSchema, readonly string[]>> = {
	set_status: [wireRequests.setEntityStatus],
	listen_mute: [wireRequests.setControls],
	talk_push_down: [wireRequests.setControls],
	talk_push_up: [wireRequests.setControls],
	talk_latch: [wireRequests.setControls],
	dismiss_alerts: [wireRequests.acknowledgeAlerts],
	refresh: [],
	run_macro: [wireRequests.runMacro],
	input_mute: [wireRequests.setControls],
	group_talk_push_down: [wireRequests.setControls],
	group_talk_push_up: [wireRequests.setControls],
	group_talk_latch: [wireRequests.setControls],
	group_mute: [wireRequests.setListening],
	call_answer: [wireRequests.setControls],
	call_talk_push_down: [wireRequests.setControls],
	call_talk_push_up: [wireRequests.setControls],
	call_talk_latch: [wireRequests.setControls],
	call_hang_up: [wireRequests.setControls],
	set_indicator_status: [wireRequests.setIndicatorStatus],
}

/** Regex string (Companion format) for a typed status indicator id: `ind-` and 32 hex digits. */
export const indicatorIdRegex = '/^ind-[0-9a-f]{32}$/'

/**
 * The indicator picker shared by the indicator action and feedbacks: the status indicators this
 * connection may set now. A typed id is accepted, so a button survives a list not yet loaded.
 */
export function indicatorOption(self: ModuleInstance): CompanionInputFieldDropdown<'indicatorId', string> {
	const choices = self.getCrewLanState().indicators.map((indicator) => ({ id: indicator.id, label: indicator.name }))

	return {
		id: 'indicatorId',
		type: 'dropdown',
		label: 'Status indicator',
		default: choices[0]?.id ?? '',
		choices: choices.length > 0 ? choices : [{ id: '', label: '— no status indicator this connection may set —' }],
		allowCustom: true,
		regex: indicatorIdRegex,
		tooltip: 'Pick a status indicator, or type its id to configure the button before the connection is up.',
		description: 'Indicator ids can be typed, so buttons can be built before the connection is up.',
	}
}

/**
 * Tells the module which control holds which action, so a readiness feedback on that control knows
 * the requests its button sends. Companion reports every placed action this way when the module
 * starts and whenever a button is edited.
 */
function reportPlacement(
	self: ModuleInstance,
	definitions: CompanionActionDefinitions<ActionsSchema>,
): CompanionActionDefinitions<ActionsSchema> {
	for (const actionId of Object.keys(definitions) as (keyof ActionsSchema)[]) {
		const definition = definitions[actionId]

		if (definition) {
			definition.optionsToMonitorForSubscribe = []
			definition.skipUnsubscribeOnOptionsChange = true
			definition.subscribe = (action: CompanionActionInfo) =>
				self.notePlacedAction(action.controlId, action.id, actionRequests[actionId])
			definition.unsubscribe = (action: CompanionActionInfo) => self.noteRemovedAction(action.controlId, action.id)
		}
	}

	return definitions
}

/** Regex string (Companion format) for a typed intercom group id: `everyone`, or `grp-` and 32 hex digits. */
export const groupIdRegex = '/^(everyone|grp-[0-9a-f]{32})$/'

/**
 * The group picker shared by the group actions and feedbacks: the groups the participant is a
 * member of, the Everyone group ("All") first. A typed id is accepted, so a button survives a list
 * not yet loaded.
 */
export function groupOption(self: ModuleInstance): CompanionInputFieldDropdown<'groupId', string> {
	const choices = (self.getCrewLanState().intercom?.groups ?? []).map((group) => ({ id: group.id, label: group.name }))

	return {
		id: 'groupId',
		type: 'dropdown',
		label: 'Group',
		default: choices[0]?.id ?? 'everyone',
		choices: choices.length > 0 ? choices : [{ id: 'everyone', label: 'All' }],
		allowCustom: true,
		regex: groupIdRegex,
		tooltip: 'Pick an intercom group, or type a group id to configure the button before the connection is up.',
		description: 'Group ids can be typed, so buttons can be built before the connection is up.',
	}
}

function asMuteMode(value: unknown): MuteMode {
	return value === 'on' || value === 'off' || value === 'toggle' ? value : 'toggle'
}

function asLatchMode(value: unknown): LatchMode {
	return value === 'on' || value === 'off' || value === 'toggle' ? value : 'toggle'
}

export function UpdateActions(self: ModuleInstance): void {
	const definitions: CompanionActionDefinitions<ActionsSchema> = {
		set_status: {
			name: 'Set My Status',
			description: 'Sets the status of the entity this connection is bound to.',
			options: [
				{
					id: 'statusId',
					type: 'dropdown',
					label: 'Status',
					default: self.getDefaultStatusChoice(),
					choices: self.getStatusChoices(),
					allowCustom: true,
					regex: statusIdRegex,
					tooltip: 'Pick a CrewLAN status, or type a status id to configure the button before the connection is up.',
					description: 'Status ids can be typed, so buttons can be built before the connection is up.',
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Set My Status', async () => {
					await self.setCrewLanStatus(String(event.options.statusId ?? ''))
				})
			},
		},
		listen_mute: {
			name: 'Output Mute On/Off/Toggle',
			description: 'Mutes or unmutes the Output, everything the participant hears.',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'Muted' },
						{ id: 'off', label: 'Unmuted' },
					],
					disableAutoExpression: true,
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Output Mute', async () => {
					await self.setListenMuteMode(asMuteMode(event.options.mode))
				})
			},
		},
		talk_push_down: {
			name: 'Global Talk Push Down',
			description: 'Opens Global Talk. Pair with "Global Talk Push Up" on the button release.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Global Talk Push Down', async () => {
					await self.setTalkState(true, 'push')
				})
			},
		},
		talk_push_up: {
			name: 'Global Talk Push Up',
			description: 'Closes Global Talk. Retried automatically; a final failure is logged as an error.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Global Talk Push Up', async () => {
					await self.setTalkState(false, 'push')
				})
			},
		},
		talk_latch: {
			name: 'Global Talk Latch Toggle/On/Off',
			description: 'Opens or closes Global Talk and keeps it in that state until changed again.',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
					disableAutoExpression: true,
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Global Talk Latch', async () => {
					await self.setTalkLatchMode(asLatchMode(event.options.mode))
				})
			},
		},
		dismiss_alerts: {
			name: 'Dismiss Alerts',
			description: 'Dismisses the alerts currently shown for this entity in CrewLAN.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Dismiss Alerts', async () => {
					await self.dismissAlerts()
				})
			},
		},
		run_macro: {
			name: 'Run Macro',
			description: 'Starts a CrewLAN macro. One-shot: there is no stop or toggle.',
			options: [
				{
					id: 'macroId',
					type: 'dropdown',
					label: 'Macro',
					default: self.getDefaultMacroChoice(),
					choices: self.getMacroChoices(),
					allowCustom: true,
					regex: macroIdRegex,
					tooltip: 'Pick a CrewLAN macro, or type a macro id to configure the button before the connection is up.',
					description: 'Macro ids can be typed, so buttons can be built before the connection is up.',
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Run Macro', async () => {
					await self.runCrewLanMacro(String(event.options.macroId ?? ''))
				})
			},
		},
		input_mute: {
			name: 'Input Mute On/Off/Toggle',
			description: 'Mutes or unmutes the Input, the microphone. Needs a Workspace serving /api/v2.',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'Muted' },
						{ id: 'off', label: 'Unmuted' },
					],
					disableAutoExpression: true,
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Input Mute', async () => {
					await self.setInputMuteMode(asMuteMode(event.options.mode))
				})
			},
		},
		group_talk_push_down: {
			name: 'Group Talk Push Down',
			description:
				'Talks to one intercom group. Pair with "Group Talk Push Up" on the button release. Needs a Workspace serving /api/v2.',
			options: [groupOption(self)],
			callback: async (event) => {
				await self.runCrewLanAction('Group Talk Push Down', async () => {
					await self.setGroupTalk(String(event.options.groupId ?? ''), true, 'push')
				})
			},
		},
		group_talk_push_up: {
			name: 'Group Talk Push Up',
			description: 'Stops talking to one intercom group. Letting go is never refused.',
			options: [groupOption(self)],
			callback: async (event) => {
				await self.runCrewLanAction('Group Talk Push Up', async () => {
					await self.setGroupTalk(String(event.options.groupId ?? ''), false, 'push')
				})
			},
		},
		group_talk_latch: {
			name: 'Group Talk Latch Toggle/On/Off',
			description:
				'Starts or stops talking to one intercom group and keeps it that way until changed again. Needs a Workspace serving /api/v2.',
			options: [
				groupOption(self),
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
					disableAutoExpression: true,
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Group Talk Latch', async () => {
					await self.setGroupTalkLatchMode(String(event.options.groupId ?? ''), asLatchMode(event.options.mode))
				})
			},
		},
		group_mute: {
			name: 'Group Mute On/Off/Toggle',
			description:
				'Mutes or unmutes what the participant hears of one intercom group, keeping its level. Needs a Workspace serving /api/v2.',
			options: [
				groupOption(self),
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'Muted' },
						{ id: 'off', label: 'Unmuted' },
					],
					disableAutoExpression: true,
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Group Mute', async () => {
					await self.setGroupMuteMode(String(event.options.groupId ?? ''), asMuteMode(event.options.mode))
				})
			},
		},
		call_answer: {
			name: 'Direct: Answer',
			description:
				'Answers the direct call ringing you. Does nothing when nobody rings. Needs a Workspace serving /api/v2.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Answer', async () => {
					await self.answerCall()
				})
			},
		},
		call_talk_push_down: {
			name: 'Direct Talk Push Down',
			description:
				'Talks in the active direct call. Pair with "Direct Talk Push Up" on the button release. Needs a Workspace serving /api/v2.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Direct Talk Push Down', async () => {
					await self.setCallTalk(true, 'push')
				})
			},
		},
		call_talk_push_up: {
			name: 'Direct Talk Push Up',
			description: 'Stops talking in the direct call. Letting go is never refused.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Direct Talk Push Up', async () => {
					await self.setCallTalk(false, 'push')
				})
			},
		},
		call_talk_latch: {
			name: 'Direct Talk Latch Toggle/On/Off',
			description:
				'Starts or stops talking in the active direct call and keeps it that way until changed again. Needs a Workspace serving /api/v2.',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
					disableAutoExpression: true,
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Direct Talk Latch', async () => {
					await self.setCallTalkLatchMode(asLatchMode(event.options.mode))
				})
			},
		},
		call_hang_up: {
			name: 'Direct: Hang up',
			description:
				'Hangs up the active direct call, or cancels your own call while it still rings. Does nothing when there is neither. Needs a Workspace serving /api/v2.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Hang up', async () => {
					await self.hangUpCall()
				})
			},
		},
		set_indicator_status: {
			name: 'Set Indicator Status',
			description:
				'Sets a status indicator this connection may set to one of the statuses it may set it to, as CrewLAN says. Needs a Workspace serving /api/v2.',
			options: [
				indicatorOption(self),
				{
					id: 'statusId',
					type: 'dropdown',
					label: 'Status',
					default: self.getDefaultStatusChoice(),
					choices: self.getStatusChoices(),
					allowCustom: true,
					regex: statusIdRegex,
					tooltip: 'Pick a CrewLAN status, or type a status id to configure the button before the connection is up.',
					description: 'Status ids can be typed, so buttons can be built before the connection is up.',
				},
			],
			callback: async (event) => {
				await self.runCrewLanAction('Set Indicator Status', async () => {
					await self.setIndicatorStatus(String(event.options.indicatorId ?? ''), String(event.options.statusId ?? ''))
				})
			},
		},
		refresh: {
			name: 'Refresh/Reconnect',
			description: 'Rebuilds the CrewLAN connection. Progress is shown by the connection status, not by the button.',
			options: [],
			callback: () => {
				// Deliberately not awaited: a full reconnect is seven requests and Companion abandons any
				// action that runs longer than 5 s.
				self.refreshCrewLan()
			},
		},
	}

	self.setActionDefinitions(reportPlacement(self, definitions))
}
