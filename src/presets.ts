import type {
  CompanionPresetDefinitions,
  CompanionPresetSection,
} from "@companion-module/base";
import type ModuleInstance from "./instance.js";
import type { ModuleSchema } from "./instance.js";
import { getCompanionStatusButtonStyle } from "./status-labels.js";

const presetFontSize = 14;
const talkActiveColor = 0x0fcf29;
const talkInactiveColor = 0x3a7542;
const listenUnmutedColor = 0x6b3535;
const listenMutedColor = 0xcf2929;

export function UpdatePresets(self: ModuleInstance): void {
  const selectableStatuses = self.getSelectableStatuses();
  const presets: CompanionPresetDefinitions<ModuleSchema> = {};
  const statusPresetIds: string[] = [];

  for (const status of selectableStatuses) {
    const inactiveStyle = getCompanionStatusButtonStyle(status, false);
    const activeStyle = getCompanionStatusButtonStyle(status, true);
    const presetId = `status_${status.id}`;

    statusPresetIds.push(presetId);
    presets[presetId] = {
      type: "simple",
      name: `Status: ${inactiveStyle.text}`,
      style: inactiveStyle,
      steps: [
        {
          down: [{ actionId: "set_status", options: { statusId: status.id } }],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: "status_is",
          options: { statusId: status.id },
          style: activeStyle,
        },
      ],
    };
  }

  presets.listen_mute_toggle = {
    type: "simple",
    name: "Listen Mute Toggle",
    style: {
      text: "Listen\nMute",
      size: presetFontSize,
      color: 0xffffff,
      bgcolor: listenUnmutedColor,
      show_topbar: false,
    },
    steps: [
      {
        down: [{ actionId: "listen_mute", options: { mode: "toggle" } }],
        up: [],
      },
    ],
    feedbacks: [
      {
        feedbackId: "listen_muted",
        options: {},
        style: {
          text: "Listen\nMute",
          size: presetFontSize,
          color: 0xffffff,
          bgcolor: listenMutedColor,
          show_topbar: false,
        },
      },
    ],
  };

  presets.talk_push = {
    type: "simple",
    name: "Talk Push",
    style: {
      text: "Talk\nPush",
      size: presetFontSize,
      color: 0xffffff,
      bgcolor: talkInactiveColor,
      show_topbar: false,
    },
    steps: [
      {
        down: [{ actionId: "talk_push_down", options: {} }],
        up: [{ actionId: "talk_push_up", options: {} }],
      },
    ],
    feedbacks: [
      {
        feedbackId: "talk_push_active",
        options: {},
        style: {
          text: "Talk\nPush",
          size: presetFontSize,
          color: 0x000000,
          bgcolor: talkActiveColor,
          show_topbar: false,
        },
      },
    ],
  };

  presets.talk_latch_toggle = {
    type: "simple",
    name: "Talk Latch",
    style: {
      text: "Talk\nLatch",
      size: presetFontSize,
      color: 0xffffff,
      bgcolor: talkInactiveColor,
      show_topbar: false,
    },
    steps: [
      {
        down: [{ actionId: "talk_latch", options: { mode: "toggle" } }],
        up: [],
      },
    ],
    feedbacks: [
      {
        feedbackId: "talk_latch_active",
        options: {},
        style: {
          text: "Talk\nLatch",
          size: presetFontSize,
          color: 0x000000,
          bgcolor: talkActiveColor,
          show_topbar: false,
        },
      },
    ],
  };

  presets.dismiss_alerts = {
    type: "simple",
    name: "Dismiss Alerts",
    style: {
      text: "Dismiss\nAlerts",
      size: presetFontSize,
      color: 0x000000,
      bgcolor: 0xffffff,
      show_topbar: false,
    },
    steps: [
      {
        down: [{ actionId: "dismiss_alerts", options: {} }],
        up: [],
      },
    ],
    feedbacks: [],
  };

  const structure: CompanionPresetSection<ModuleSchema>[] = [
    ...(statusPresetIds.length > 0
      ? [
          {
            id: "status",
            name: "Status",
            definitions: [
              {
                id: "status-buttons",
                type: "simple" as const,
                name: "Status Buttons",
                presets: statusPresetIds,
              },
            ],
          },
        ]
      : []),
    {
      id: "shoutbox",
      name: "Shoutbox",
      definitions: [
        {
          id: "shoutbox-controls",
          type: "simple",
          name: "Live Controls",
          presets: ["listen_mute_toggle", "talk_push", "talk_latch_toggle"],
        },
      ],
    },
    {
      id: "alerts",
      name: "Alerts",
      definitions: [
        {
          id: "alert-actions",
          type: "simple",
          name: "Alert Actions",
          presets: ["dismiss_alerts"],
        },
      ],
    },
  ];

  self.setPresetDefinitions(structure, presets);
}
