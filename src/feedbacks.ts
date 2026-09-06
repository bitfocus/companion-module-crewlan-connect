import { combineRgb } from '@companion-module/base'
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
}

function isCurrentStatus(self: ModuleInstance, statusId: string): boolean {
	const currentStatus = self.getCrewLanState().status

	return statusId.length > 0 && (currentStatus?.selectedStatusId === statusId || currentStatus?.status.id === statusId)
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
			name: 'Listen Enabled',
			description: 'True when the Shoutbox listen channel is enabled for this entity.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.listen.enabled === true,
		},
		listen_available: {
			name: 'Listen Available',
			description: 'True when the listen channel is available in the current workspace.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.listen.available === true,
		},
		listen_muted: {
			name: 'Listen Muted',
			description: 'True while the listen channel is muted.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.listen.muted === true,
		},
		talk_enabled: {
			name: 'Talk Enabled',
			description: 'True when the Shoutbox talk channel is enabled for this entity.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.enabled === true,
		},
		talk_available: {
			name: 'Talk Available',
			description: 'True when the talk channel is available in the current workspace.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.available === true,
		},
		talk_push_active: {
			name: 'Talk Push Active',
			description: 'True while talk is active and was opened in push mode.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => {
				const talk = self.getCrewLanState().controls?.shoutbox.talk

				return talk?.active === true && talk.controlMode === 'push'
			},
		},
		talk_latch_active: {
			name: 'Talk Latch Active',
			description: 'True while talk is active and was opened in latch mode.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => {
				const talk = self.getCrewLanState().controls?.shoutbox.talk

				return talk?.active === true && talk.controlMode === 'latch'
			},
		},
		talk_active: {
			name: 'Talk Active',
			description: 'True while talk is active, in either push or latch mode.',
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
			name: 'Talk Live',
			description: 'True while CrewLAN reports the microphone as live on the device.',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.getCrewLanState().controls?.shoutbox.talk.live === true,
		},
	})
}
