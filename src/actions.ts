import { statusIdRegex } from './config.js'
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
}

function asMuteMode(value: unknown): MuteMode {
	return value === 'on' || value === 'off' || value === 'toggle' ? value : 'toggle'
}

function asLatchMode(value: unknown): LatchMode {
	return value === 'on' || value === 'off' || value === 'toggle' ? value : 'toggle'
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
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
			name: 'Listen Mute On/Off/Toggle',
			description: 'Mutes or unmutes the Shoutbox listen channel.',
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
				await self.runCrewLanAction('Listen Mute', async () => {
					await self.setListenMuteMode(asMuteMode(event.options.mode))
				})
			},
		},
		talk_push_down: {
			name: 'Talk Push Down',
			description: 'Opens the talk channel. Pair with "Talk Push Up" on the button release.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Talk Push Down', async () => {
					await self.setTalkState(true, 'push')
				})
			},
		},
		talk_push_up: {
			name: 'Talk Push Up',
			description: 'Closes the talk channel. Retried automatically; a final failure is logged as an error.',
			options: [],
			callback: async () => {
				await self.runCrewLanAction('Talk Push Up', async () => {
					await self.setTalkState(false, 'push')
				})
			},
		},
		talk_latch: {
			name: 'Talk Latch Toggle/On/Off',
			description: 'Opens or closes the talk channel and keeps it in that state until changed again.',
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
				await self.runCrewLanAction('Talk Latch', async () => {
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
		refresh: {
			name: 'Refresh/Reconnect',
			description: 'Rebuilds the CrewLAN connection. Progress is shown by the connection status, not by the button.',
			options: [],
			callback: () => {
				// Deliberately not awaited: a full reconnect is six requests and Companion abandons any
				// action that runs longer than 5 s.
				self.refreshCrewLan()
			},
		},
	})
}
