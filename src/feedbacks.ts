import { combineRgb } from "@companion-module/base";
import type ModuleInstance from "./instance.js";
import { getCompanionStatusButtonStyle } from "./status-labels.js";

export type FeedbacksSchema = {
  connection_ok: { type: "boolean"; options: Record<string, never> };
  status_is: { type: "boolean"; options: { statusId: string } };
  status_style: { type: "advanced"; options: { statusId: string } };
  listen_enabled: { type: "boolean"; options: Record<string, never> };
  listen_available: { type: "boolean"; options: Record<string, never> };
  listen_muted: { type: "boolean"; options: Record<string, never> };
  talk_enabled: { type: "boolean"; options: Record<string, never> };
  talk_available: { type: "boolean"; options: Record<string, never> };
  talk_push_active: { type: "boolean"; options: Record<string, never> };
  talk_latch_active: { type: "boolean"; options: Record<string, never> };
  talk_active: { type: "boolean"; options: Record<string, never> };
  talk_live: { type: "boolean"; options: Record<string, never> };
};

function isCurrentStatus(self: ModuleInstance, statusId: string): boolean {
  const currentStatus = self.getCrewLanState().status;

  return (
    statusId.length > 0 &&
    (currentStatus?.selectedStatusId === statusId || currentStatus?.status.id === statusId)
  );
}

export function UpdateFeedbacks(self: ModuleInstance): void {
  self.setFeedbackDefinitions({
    connection_ok: {
      name: "Connection OK",
      type: "boolean",
      defaultStyle: {
        bgcolor: combineRgb(48, 167, 91),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => self.getCrewLanState().connected,
    },
    status_is: {
      name: "Current Status Is",
      type: "boolean",
      defaultStyle: {
        bgcolor: combineRgb(41, 121, 255),
        color: combineRgb(255, 255, 255),
      },
      options: [
        {
          id: "statusId",
          type: "dropdown",
          label: "Status",
          default: self.getDefaultStatusChoice(),
          choices: self.getStatusChoices(),
        },
      ],
      callback: (feedback) => {
        const statusId = String(feedback.options.statusId ?? "");

        return isCurrentStatus(self, statusId);
      },
    },
    status_style: {
      name: "Current Status Style",
      type: "advanced",
      options: [
        {
          id: "statusId",
          type: "dropdown",
          label: "Status",
          default: self.getDefaultStatusChoice(),
          choices: self.getStatusChoices(),
        },
      ],
      callback: (feedback) => {
        const statusId = String(feedback.options.statusId ?? "");
        const status = self.getCrewLanState().statuses.find((candidate) => candidate.id === statusId);

        if (status === undefined) {
          return {};
        }

        return getCompanionStatusButtonStyle(status, isCurrentStatus(self, statusId));
      },
    },
    listen_enabled: {
      name: "Listen Enabled",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.listen.enabled === true,
    },
    listen_available: {
      name: "Listen Available",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.listen.available === true,
    },
    listen_muted: {
      name: "Listen Muted",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.listen.muted === true,
    },
    talk_enabled: {
      name: "Talk Enabled",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.talk.enabled === true,
    },
    talk_available: {
      name: "Talk Available",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(48, 167, 91), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.talk.available === true,
    },
    talk_push_active: {
      name: "Talk Push Active",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
      options: [],
      callback: () => {
        const talk = self.getCrewLanState().controls?.shoutbox.talk;

        return talk?.active === true && talk.controlMode === "push";
      },
    },
    talk_latch_active: {
      name: "Talk Latch Active",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(15, 207, 41), color: combineRgb(0, 0, 0) },
      options: [],
      callback: () => {
        const talk = self.getCrewLanState().controls?.shoutbox.talk;

        return talk?.active === true && talk.controlMode === "latch";
      },
    },
    talk_active: {
      name: "Talk Active",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(255, 152, 0), color: combineRgb(0, 0, 0) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.talk.active === true,
    },
    talk_live: {
      name: "Talk Live",
      type: "boolean",
      defaultStyle: { bgcolor: combineRgb(244, 67, 54), color: combineRgb(255, 255, 255) },
      options: [],
      callback: () => self.getCrewLanState().controls?.shoutbox.talk.live === true,
    },
  });
}
