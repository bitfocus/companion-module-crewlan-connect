import type { CompanionButtonStyleProps } from '@companion-module/base'
import type { PublicMacroDto, PublicStatusDto } from './types.js'

export const buttonFontSize = 14
export const inactiveBackgroundDimFactor = 0.32
/** Fallback background when CrewLAN sends an unusable status colour. */
const statusFallbackBackground = 0x2979ff
/** Fallback background when CrewLAN sends an unusable macro colour. */
const macroFallbackBackground = 0x8e24aa

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

export function colorToNumber(value: string, fallback: number): number {
	if (!/^#[0-9a-f]{6}$/iu.test(value)) {
		return fallback
	}

	return Number.parseInt(value.slice(1), 16)
}

export function dimColor(value: string, fallback: number): number {
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
 * The label and colours CrewLAN publishes for one thing that can be active or not.
 *
 * This is the subset an advanced feedback may override: it leaves font size and the top bar to the
 * user, who would otherwise be unable to style their own button.
 */
export function getCompanionStyle(input: {
	text: string
	colors: { backgroundColor: string; foregroundColor: string }
	active: boolean
	fallbackBackground: number
}): Pick<CompanionButtonStyleProps, 'text' | 'color' | 'bgcolor'> {
	return {
		text: input.text,
		color: colorToNumber(input.colors.foregroundColor, 0xffffff),
		bgcolor: input.active
			? colorToNumber(input.colors.backgroundColor, input.fallbackBackground)
			: dimColor(input.colors.backgroundColor, input.fallbackBackground),
	}
}

/** The full button style used by the presets this module ships. */
export function getCompanionButtonStyle(input: {
	text: string
	colors: { backgroundColor: string; foregroundColor: string }
	active: boolean
	fallbackBackground: number
}): CompanionButtonStyleProps {
	return {
		...getCompanionStyle(input),
		size: buttonFontSize,
		show_topbar: false,
	}
}

export function getCompanionStatusStyle(
	status: PublicStatusDto,
	active: boolean,
): Pick<CompanionButtonStyleProps, 'text' | 'color' | 'bgcolor'> {
	return getCompanionStyle({
		text: getCompanionStatusLabel(status),
		colors: status.colors,
		active,
		fallbackBackground: statusFallbackBackground,
	})
}

export function getCompanionStatusButtonStyle(status: PublicStatusDto, active: boolean): CompanionButtonStyleProps {
	return getCompanionButtonStyle({
		text: getCompanionStatusLabel(status),
		colors: status.colors,
		active,
		fallbackBackground: statusFallbackBackground,
	})
}

/**
 * Macro labels are used verbatim: there is no macro analogue of the system-status vocabulary that
 * getCompanionStatusLabel() normalises.
 */
export function getCompanionMacroStyle(
	macro: PublicMacroDto,
	running: boolean,
): Pick<CompanionButtonStyleProps, 'text' | 'color' | 'bgcolor'> {
	return getCompanionStyle({
		text: macro.label,
		colors: macro.colors,
		active: running,
		fallbackBackground: macroFallbackBackground,
	})
}

export function getCompanionMacroButtonStyle(macro: PublicMacroDto, running: boolean): CompanionButtonStyleProps {
	return getCompanionButtonStyle({
		text: macro.label,
		colors: macro.colors,
		active: running,
		fallbackBackground: macroFallbackBackground,
	})
}
