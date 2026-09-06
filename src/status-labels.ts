import type { CompanionButtonStyleProps } from '@companion-module/base'
import type { PublicStatusDto } from './types.js'

const statusButtonFontSize = 14
const inactiveBackgroundDimFactor = 0.32

const identitySystemStatusLabels: Record<string, string> = {
	'sys-green': 'Ready',
	ok: 'Ready',
	ready: 'Ready',
	'sys-yellow': 'Attention',
	warning: 'Attention',
	attention: 'Attention',
	'sys-red': 'Critical',
	emergency: 'Critical',
	critical: 'Critical',
	'sys-idle': 'Standby',
	idle: 'Standby',
	standby: 'Standby',
	'sys-offline': 'Offline',
	offline: 'Offline',
}

export function getCompanionStatusLabel(status: PublicStatusDto): string {
	if (status.kind !== 'system') {
		return status.label
	}

	return identitySystemStatusLabels[status.id] ?? status.label
}

function colorToNumber(value: string, fallback: number): number {
	if (!/^#[0-9a-f]{6}$/iu.test(value)) {
		return fallback
	}

	return Number.parseInt(value.slice(1), 16)
}

function dimColor(value: string, fallback: number): number {
	const color = colorToNumber(value, fallback)
	const red = (color >> 16) & 0xff
	const green = (color >> 8) & 0xff
	const blue = color & 0xff

	return (
		(Math.round(red * inactiveBackgroundDimFactor) << 16) |
		(Math.round(green * inactiveBackgroundDimFactor) << 8) |
		Math.round(blue * inactiveBackgroundDimFactor)
	)
}

/**
 * The label and colours CrewLAN publishes for a status.
 *
 * This is the subset an advanced feedback may override: it leaves font size and the top bar to the
 * user, who would otherwise be unable to style their own button.
 */
export function getCompanionStatusStyle(
	status: PublicStatusDto,
	active: boolean,
): Pick<CompanionButtonStyleProps, 'text' | 'color' | 'bgcolor'> {
	return {
		text: getCompanionStatusLabel(status),
		color: colorToNumber(status.colors.foregroundColor, 0xffffff),
		bgcolor: active
			? colorToNumber(status.colors.backgroundColor, 0x2979ff)
			: dimColor(status.colors.backgroundColor, 0x2979ff),
	}
}

/** The full button style used by the presets this module ships. */
export function getCompanionStatusButtonStyle(status: PublicStatusDto, active: boolean): CompanionButtonStyleProps {
	return {
		...getCompanionStatusStyle(status, active),
		size: statusButtonFontSize,
		show_topbar: false,
	}
}
