import type ModuleInstance from "./instance.js";
import { getCompanionStatusLabel } from "./status-labels.js";

export type VariablesSchema = {
  workspace_name: string;
  entity_name: string;
  entity_position: string;
  current_status_id: string;
  current_status_label: string;
  current_status_motion: string;
  listen_enabled: string;
  listen_available: string;
  listen_muted: string;
  talk_enabled: string;
  talk_available: string;
  talk_active: string;
  talk_live: string;
  talk_control_mode: string;
  last_alert: string;
  last_error: string;
};

function boolValue(value: boolean | undefined): string {
  return value === true ? "true" : "false";
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
  self.setVariableDefinitions({
    workspace_name: { name: "Workspace name" },
    entity_name: { name: "Entity name" },
    entity_position: { name: "Entity position" },
    current_status_id: { name: "Current status id" },
    current_status_label: { name: "Current status label" },
    current_status_motion: { name: "Current status motion preset" },
    listen_enabled: { name: "Listen channel enabled" },
    listen_available: { name: "Listen channel available" },
    listen_muted: { name: "Listen channel muted" },
    talk_enabled: { name: "Talk channel enabled" },
    talk_available: { name: "Talk channel available" },
    talk_active: { name: "Talk control active" },
    talk_live: { name: "Talk live state" },
    talk_control_mode: { name: "Talk control mode" },
    last_alert: { name: "Last alert" },
    last_error: { name: "Last error" },
  });
}

export function UpdateVariableValues(self: ModuleInstance): void {
  const state = self.getCrewLanState();
  const listen = state.controls?.shoutbox.listen;
  const talk = state.controls?.shoutbox.talk;

  self.setVariableValues({
    workspace_name: state.workspace?.name ?? "",
    entity_name: state.entity?.displayName ?? "",
    entity_position: state.entity?.position ?? "",
    current_status_id: state.status?.selectedStatusId ?? "",
    current_status_label:
      state.status === null ? "" : getCompanionStatusLabel(state.status.status),
    current_status_motion: state.status?.status.motionPreset ?? "",
    listen_enabled: boolValue(listen?.enabled),
    listen_available: boolValue(listen?.available),
    listen_muted: boolValue(listen?.muted),
    talk_enabled: boolValue(talk?.enabled),
    talk_available: boolValue(talk?.available),
    talk_active: boolValue(talk?.active),
    talk_live: boolValue(talk?.live),
    talk_control_mode: talk?.controlMode ?? "",
    last_alert: state.lastAlert,
    last_error: state.lastError,
  });
}
