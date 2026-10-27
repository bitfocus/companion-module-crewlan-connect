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
	api_version: string
	input_muted: boolean
	intercom_ringing_caller: string
	intercom_call_partner: string
	target_kind: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		workspace_name: { name: 'Workspace name' },
		entity_name: { name: 'Entity name' },
		entity_position: { name: 'Entity position' },
		current_status_id: { name: 'Current status id' },
		current_status_label: { name: 'Current status label' },
		current_status_motion: { name: 'Current status motion preset' },
		listen_enabled: { name: 'Output enabled' },
		listen_available: { name: 'Output available' },
		listen_muted: { name: 'Output muted' },
		talk_enabled: { name: 'Global Talk enabled' },
		talk_available: { name: 'Global Talk available' },
		talk_active: { name: 'Global Talk active' },
		talk_live: { name: 'Microphone live' },
		talk_control_mode: { name: 'Global Talk control mode' },
		event_stream_connected: { name: 'Live event stream connected' },
		macros_supported: { name: 'CrewLAN offers macros' },
		running_macro_count: { name: 'Running macro count' },
		running_macro_labels: { name: 'Running macro labels' },
		last_alert: { name: 'Last alert' },
		last_error: { name: 'Last error' },
		api_version: { name: 'CrewLAN API spoken (v1 or v2)' },
		input_muted: { name: 'Input muted' },
		intercom_ringing_caller: { name: 'Direct: who rings' },
		intercom_call_partner: { name: 'Direct: who the call is with, or whom your own call rings' },
		target_kind: { name: 'What the connection acts for: identity or indicator (v2 only)' },
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
		api_version: state.api ?? '',
		input_muted: state.intercom?.inputMuted === true,
		intercom_ringing_caller: state.intercom?.ringing?.name ?? '',
		intercom_call_partner: state.intercom?.call?.name ?? state.intercom?.calling?.name ?? '',
		target_kind: state.targetKind ?? '',
	})
}
