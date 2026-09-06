import type ModuleInstance from './main.js'
import { getCompanionStatusLabel } from './button-style.js'

export type VariablesSchema = {
	workspace_name: string
	entity_name: string
	entity_position: string
	current_status_id: string
	current_status_label: string
	current_status_motion: string
	listen_enabled: boolean
	listen_available: boolean
	listen_muted: boolean
	talk_enabled: boolean
	talk_available: boolean
	talk_active: boolean
	talk_live: boolean
	talk_control_mode: string
	event_stream_connected: boolean
	macros_supported: boolean
	running_macro_count: number
	running_macro_labels: string
	last_alert: string
	last_error: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		workspace_name: { name: 'Workspace name' },
		entity_name: { name: 'Entity name' },
		entity_position: { name: 'Entity position' },
		current_status_id: { name: 'Current status id' },
		current_status_label: { name: 'Current status label' },
		current_status_motion: { name: 'Current status motion preset' },
		listen_enabled: { name: 'Listen channel enabled' },
		listen_available: { name: 'Listen channel available' },
		listen_muted: { name: 'Listen channel muted' },
		talk_enabled: { name: 'Talk channel enabled' },
		talk_available: { name: 'Talk channel available' },
		talk_active: { name: 'Talk control active' },
		talk_live: { name: 'Talk live state' },
		talk_control_mode: { name: 'Talk control mode' },
		event_stream_connected: { name: 'Live event stream connected' },
		macros_supported: { name: 'CrewLAN offers macros' },
		running_macro_count: { name: 'Running macro count' },
		running_macro_labels: { name: 'Running macro labels' },
		last_alert: { name: 'Last alert' },
		last_error: { name: 'Last error' },
	})
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const state = self.getCrewLanState()
	const listen = state.controls?.shoutbox.listen
	const talk = state.controls?.shoutbox.talk
	const runningMacros = state.macros.filter((macro) => macro.running)

	self.setVariableValues({
		workspace_name: state.workspace?.name ?? '',
		entity_name: state.entity?.displayName ?? '',
		entity_position: state.entity?.position ?? '',
		current_status_id: state.status?.selectedStatusId ?? '',
		current_status_label: state.status === null ? '' : getCompanionStatusLabel(state.status.status),
		current_status_motion: state.status?.status.motionPreset ?? '',
		listen_enabled: listen?.enabled === true,
		listen_available: listen?.available === true,
		listen_muted: listen?.muted === true,
		talk_enabled: talk?.enabled === true,
		talk_available: talk?.available === true,
		talk_active: talk?.active === true,
		talk_live: talk?.live === true,
		talk_control_mode: talk?.controlMode ?? '',
		event_stream_connected: state.streamConnected,
		macros_supported: state.macrosSupported,
		running_macro_count: runningMacros.length,
		running_macro_labels: runningMacros.map((macro) => macro.label).join(', '),
		last_alert: state.lastAlert,
		last_error: state.lastError,
	})
}
