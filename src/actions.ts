import type ModuleInstance from "./instance.js";

type MuteMode = "toggle" | "on" | "off";
type LatchMode = "toggle" | "on" | "off";

export type ActionsSchema = {
  set_status: {
    options: {
      statusId: string;
    };
  };
  listen_mute: {
    options: {
      mode: MuteMode;
    };
  };
  talk_push_down: {
    options: Record<string, never>;
  };
  talk_push_up: {
    options: Record<string, never>;
  };
  talk_latch: {
    options: {
      mode: LatchMode;
    };
  };
  dismiss_alerts: {
    options: Record<string, never>;
  };
  refresh: {
    options: Record<string, never>;
  };
};

function asMuteMode(value: unknown): MuteMode {
  return value === "on" || value === "off" || value === "toggle" ? value : "toggle";
}

function asLatchMode(value: unknown): LatchMode {
  return value === "on" || value === "off" || value === "toggle" ? value : "toggle";
}

export function UpdateActions(self: ModuleInstance): void {
  self.setActionDefinitions({
    set_status: {
      name: "Set My Status",
      options: [
        {
          id: "statusId",
          type: "dropdown",
          label: "Status",
          default: self.getDefaultStatusChoice(),
          choices: self.getStatusChoices(),
        },
      ],
      callback: async (event) => {
        await self.runCrewLanAction("Set My Status", async () => {
          await self.setCrewLanStatus(String(event.options.statusId ?? ""));
        });
      },
    },
    listen_mute: {
      name: "Listen Mute On/Off/Toggle",
      options: [
        {
          id: "mode",
          type: "dropdown",
          label: "Mode",
          default: "toggle",
          choices: [
            { id: "toggle", label: "Toggle" },
            { id: "on", label: "Muted" },
            { id: "off", label: "Unmuted" },
          ],
        },
      ],
      callback: async (event) => {
        await self.runCrewLanAction("Listen Mute", async () => {
          await self.setListenMuteMode(asMuteMode(event.options.mode));
        });
      },
    },
    talk_push_down: {
      name: "Talk Push Down",
      options: [],
      callback: async () => {
        await self.runCrewLanAction("Talk Push Down", async () => {
          await self.setTalkState(true, "push");
        });
      },
    },
    talk_push_up: {
      name: "Talk Push Up",
      options: [],
      callback: async () => {
        await self.runCrewLanAction("Talk Push Up", async () => {
          await self.setTalkState(false, "push");
        });
      },
    },
    talk_latch: {
      name: "Talk Latch Toggle/On/Off",
      options: [
        {
          id: "mode",
          type: "dropdown",
          label: "Mode",
          default: "toggle",
          choices: [
            { id: "toggle", label: "Toggle" },
            { id: "on", label: "On" },
            { id: "off", label: "Off" },
          ],
        },
      ],
      callback: async (event) => {
        await self.runCrewLanAction("Talk Latch", async () => {
          await self.setTalkLatchMode(asLatchMode(event.options.mode));
        });
      },
    },
    dismiss_alerts: {
      name: "Dismiss Alerts",
      options: [],
      callback: async () => {
        await self.runCrewLanAction("Dismiss Alerts", async () => {
          await self.dismissAlerts();
        });
      },
    },
    refresh: {
      name: "Refresh/Reconnect",
      options: [],
      callback: async () => {
        await self.runCrewLanAction("Refresh/Reconnect", async () => {
          await self.refreshCrewLan();
        });
      },
    },
  });
}
