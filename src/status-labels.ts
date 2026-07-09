import type { CompanionButtonStyleProps } from "@companion-module/base";
import type { PublicStatusDto } from "./types.js";

const defaultPresetFontSize = 14;
const inactiveBackgroundDimFactor = 0.32;

const identitySystemStatusLabels: Record<string, string> = {
  "sys-green": "Ready",
  ok: "Ready",
  ready: "Ready",
  "sys-yellow": "Attention",
  warning: "Attention",
  attention: "Attention",
  "sys-red": "Critical",
  emergency: "Critical",
  critical: "Critical",
  "sys-idle": "Standby",
  idle: "Standby",
  standby: "Standby",
  "sys-offline": "Offline",
  offline: "Offline",
};

export function getCompanionStatusLabel(status: PublicStatusDto): string {
  if (status.kind !== "system") {
    return status.label;
  }

  return identitySystemStatusLabels[status.id] ?? status.label;
}

function colorToNumber(value: string, fallback: number): number {
  if (!/^#[0-9a-f]{6}$/iu.test(value)) {
    return fallback;
  }

  return Number.parseInt(value.slice(1), 16);
}

function dimColor(value: string, fallback: number): number {
  const color = colorToNumber(value, fallback);
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;

  return (
    (Math.round(red * inactiveBackgroundDimFactor) << 16) |
    (Math.round(green * inactiveBackgroundDimFactor) << 8) |
    Math.round(blue * inactiveBackgroundDimFactor)
  );
}

export function getCompanionStatusFontSize(
  status: PublicStatusDto,
): CompanionButtonStyleProps["size"] {
  void status;
  return defaultPresetFontSize;
}

export function getCompanionStatusButtonStyle(
  status: PublicStatusDto,
  active: boolean,
): CompanionButtonStyleProps {
  return {
    text: getCompanionStatusLabel(status),
    size: getCompanionStatusFontSize(status),
    color: colorToNumber(status.colors.foregroundColor, 0xffffff),
    bgcolor: active
      ? colorToNumber(status.colors.backgroundColor, 0x2979ff)
      : dimColor(status.colors.backgroundColor, 0x2979ff),
    show_topbar: false,
  };
}
