import { combineRgb } from '@companion-module/base'
import { groupOption } from './actions.js'
import { macroIdRegex, statusIdRegex } from './config.js'
import type ModuleInstance from './main.js'
import { getCompanionMacroStyle, getCompanionStatusStyle } from './button-style.js'

export type FeedbacksSchema = {
	connection_ok: { type: 'boolean'; options: Record<string, never> }
	status_is: { type: 'boolean'; options: { statusId: string } }
	status_style: { type: 'advanced'; options: { statusId: string } }
	listen_enabled: { type: 'boolean'; options: Record<string, never> }
	listen_available: { type: 'boolean'; options: Record<string, never> }
	listen_muted: { type: 'boolean'; options: Record<string, never> }
	talk_enabled: { type: 'boolean'; options: Record<string, never> }
	talk_available: { type: 'boolean'; options: Record<string, never> }
	talk_push_active: { type: 'boolean'; options: Record<string, never> }
	talk_latch_active: { type: 'boolean'; options: Record<string, never> }
	talk_active: { type: 'boolean'; options: Record<string, never> }
	talk_live: { type: 'boolean'; options: Record<string, never> }
	macro_running: { type: 'boolean'; options: { macroId: string } }
	macro_style: { type: 'advanced'; options: { macroId: string } }
	connection_ready: { type: 'boolean'; options: Record<string, never> }
	input_muted: { type: 'boolean'; options: Record<string, never> }
	group_talk_available: { type: 'boolean'; options: { groupId: string } }
	group_talk_active: { type: 'boolean'; options: { groupId: string } }
	group_muted: { type: 'boolean'; options: { groupId: string } }
	call_ringing: { type: 'boolean'; options: Record<string, never> }
	call_active: { type: 'boolean'; options: Record<string, never> }
	answer_available: { type: 'boolean'; options: Record<string, never> }
	group_member: { type: 'boolean'; options: { groupId: string } }
}

function isCurrentStatus(self: ModuleInstance, statusId: string): boolean {
	const currentStatus = self.getCrewLanState().status

	return statusId.length > 0 && (currentStatus?.selectedStatusId === statusId || currentStatus?.status.id === statusId)
}

/**
 * Connected, and the bound Entity is present at a Client, so CrewLAN accepts its writes.
 *
 * Only the readiness feedbacks read this; the state feedbacks say what CrewLAN reports, ready or
 * not, so a 1.x button and its `$(crewlan:…)` variable agree. A preset greys a key that is not
 * ready by its last feedback, its readiness feedback inverted with the offline style, which paints
 * over every state feedback before it.
 */
export function isConnectionReady(self: ModuleInstance): boolean {
	const state = self.getCrewLanState()

	return state.connected && state.ownerPresent
}

function intercomGroup(self: ModuleInstance, groupId: string | undefined) {
	return self.getCrewLanState().intercom?.groups.find((group) => group.id === groupId)
}

/** Whether a talk key or *Answer* can be pressed: ready, with an audio connection and not in a call. */
function intercomKeysAvailable(self: ModuleInstance): boolean {
	const intercom = self.getCrewLanState().intercom

	return isConnectionReady(self) && intercom?.audioConnected === true && intercom.call === null
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		connection_ok: {
			name: 'Connection OK',
			description: 'True while the module is connected to CrewLAN and the entity snapshot is loaded.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(48, 167, 91),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.getCrewLanState().connected,
		},
		connection_ready: {
			name: 'Connection Ready',
			description:
				'True while the module is connected and the participant is present at a Client, so CrewLAN accepts its presses.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(48, 167, 91),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => isConnectionReady(self),
		},
		status_is: {
			name: 'Current Status Is',
			description: "True when the selected status is the entity's current status.",
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(41, 121, 255),
				color: combineRgb(255, 255, 255),
			},
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
			callback: (feedback) => {
				const statusId = String(feedback.options.statusId ?? '')

				return isCurrentStatus(self, statusId)
			},
		},
		status_style: {
			name: 'Current Status Style',
			description:
				'Paints the button with the label and colours CrewLAN publishes for the selected status, dimmed while it is not the current one.',
			type: 'advanced',
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
			callback: (feedback) => {
				const statusId = String(feedback.options.statusId ?? '')
				const status = self.getCrewLanState().statuses.find((candidate) => candidate.id === statusId)

				if (status === undefined) {
					return {}
				}

				// Only text and colours are overridden; size and the top bar stay under the user's control.
				return getCompanionStatusStyle(status, isCurrentStatus(self, statusId))
			},
		},
		listen_enabled: {
			name: 'Output Enabled',
			description: 'True when the Output is enabled for this entity.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.listen.enabled === true,
		},
		listen_available: {
			name: 'Output Available',
			description: 'True when the Output is available in the current workspace.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.listen.available === true,
		},
		listen_muted: {
			name: 'Output Muted',
			description: 'True while the Output is muted.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.listen.muted === true,
		},
		talk_enabled: {
			name: 'Global Talk Enabled',
			description: 'True when Global Talk is enabled for this entity.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.enabled === true,
		},
		talk_available: {
			name: 'Global Talk Available',
			description:
				'True when Global Talk can be pressed: the participant holds an audio connection and is not in a direct call.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.available === true,
		},
		talk_push_active: {
			name: 'Global Talk Push Active',
			description: 'True while Global Talk is active and was opened in push mode.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => {
				const talk = self.getCrewLanState().controls?.shoutbox.talk

				return talk?.active === true && talk.controlMode === 'push'
			},
		},
		talk_latch_active: {
			name: 'Global Talk Latch Active',
			description: 'True while Global Talk is active and was opened in latch mode.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => {
				const talk = self.getCrewLanState().controls?.shoutbox.talk

				return talk?.active === true && talk.controlMode === 'latch'
			},
		},
		talk_active: {
			name: 'Global Talk Active',
			description: 'True while Global Talk is active, in either push or latch mode.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(255, 152, 0), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.active === true,
		},
		macro_running: {
			name: 'Macro Running',
			description: 'True while the selected macro is running.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
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
			callback: (feedback) => self.isMacroRunning(String(feedback.options.macroId ?? '')),
		},
		macro_style: {
			name: 'Macro Style',
			description:
				'Paints the button with the label and colours CrewLAN publishes for the selected macro, dimmed while it is not running.',
			type: 'advanced',
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
			callback: (feedback) => {
				const macroId = String(feedback.options.macroId ?? '')
				const macro = self.getCrewLanState().macros.find((candidate) => candidate.id === macroId)

				if (macro === undefined) {
					return {}
				}

				// Only text and colours are overridden; size and the top bar stay under the user's control.
				return getCompanionMacroStyle(macro, macro.running)
			},
		},
		talk_live: {
			name: 'Microphone Live',
			description: 'True while CrewLAN reports the microphone as live on the device.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.live === true,
		},
		input_muted: {
			name: 'Input Muted',
			description: 'True while the Input, the microphone, is muted. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().intercom?.inputMuted === true,
		},
		group_talk_available: {
			name: 'Group Talk Available',
			description:
				'True while the connection is ready, the participant is a member of the group, holds an audio connection and is not in a direct call. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [groupOption(self)],
			callback: (feedback) =>
				intercomKeysAvailable(self) && intercomGroup(self, feedback.options.groupId) !== undefined,
		},
		group_talk_active: {
			name: 'Group Talk Active',
			description: "True while the participant's talk key for the group is held, push or latch. Needs /api/v2.",
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
			options: [groupOption(self)],
			callback: (feedback) => intercomGroup(self, feedback.options.groupId)?.talkHeld === true,
		},
		group_muted: {
			name: 'Group Muted',
			description: 'True while the participant hears nothing of the group. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
			options: [groupOption(self)],
			callback: (feedback) => intercomGroup(self, feedback.options.groupId)?.muted === true,
		},
		call_ringing: {
			name: 'Direct: Ringing',
			description: 'True while somebody rings the participant for a direct call. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(255, 152, 0), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => (self.getCrewLanState().intercom?.ringing.length ?? 0) > 0,
		},
		call_active: {
			name: 'Direct: In a Call',
			description: 'True while the participant is in a direct call. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => (self.getCrewLanState().intercom?.call ?? null) !== null,
		},
		answer_available: {
			name: 'Direct: Answer Available',
			description:
				'True while the connection is ready, the participant holds an audio connection and is not in a direct call. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => intercomKeysAvailable(self),
		},
		group_member: {
			name: 'Group Member',
			description: 'True while the connection is ready and the participant is a member of the group. Needs /api/v2.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [groupOption(self)],
			callback: (feedback) => isConnectionReady(self) && intercomGroup(self, feedback.options.groupId) !== undefined,
		},
	})
}
