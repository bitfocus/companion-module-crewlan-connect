import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	getCompanionMacroButtonStyle,
	getCompanionStatusButtonStyle,
	getCompanionStatusLabel,
} from '../src/button-style.js'
import type { PublicMacroDto, PublicStatusDto } from '../src/types.js'

function createStatus(input: Partial<PublicStatusDto>): PublicStatusDto {
	return {
		id: 'sys-green',
		kind: 'system',
		label: 'OK',
		paletteKey: 'green',
		colors: {
			backgroundColor: '#0f8f4f',
			foregroundColor: '#ffffff',
		},
		alertType: null,
		motionPreset: 'none',
		selectable: true,
		...input,
	}
}

describe('Companion status labels', () => {
	it('uses CrewLAN Identity labels for system statuses', () => {
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'sys-green', label: 'OK' })), 'Ready')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'sys-yellow', label: 'Warnung' })), 'Attention')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'sys-red', label: 'Notfall' })), 'Critical')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'sys-idle', label: 'Idle' })), 'Standby')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'sys-offline', label: 'Offline' })), 'Offline')
	})

	it('keeps legacy CrewLAN system status ids readable', () => {
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'ok', label: 'OK' })), 'Ready')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'warning', label: 'Warnung' })), 'Attention')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'emergency', label: 'Notfall' })), 'Critical')
		assert.equal(getCompanionStatusLabel(createStatus({ id: 'idle', label: 'Idle' })), 'Standby')
	})

	it('keeps custom status labels unchanged', () => {
		assert.equal(
			getCompanionStatusLabel(createStatus({ id: 'custom-showtime', kind: 'custom', label: 'Showtime' })),
			'Showtime',
		)
	})

	it('dims inactive status colors and keeps active colors full', () => {
		const status = createStatus({
			colors: {
				backgroundColor: '#0fcf29',
				foregroundColor: '#101820',
			},
		})

		const inactiveStyle = getCompanionStatusButtonStyle(status, false)
		const activeStyle = getCompanionStatusButtonStyle(status, true)

		assert.equal(inactiveStyle.size, 14)
		assert.equal(inactiveStyle.bgcolor, 0x05420d)
		assert.equal(activeStyle.bgcolor, 0x0fcf29)
		assert.equal(inactiveStyle.color, 0x101820)
		assert.equal(activeStyle.color, 0x101820)
	})
})

describe('Companion macro button styles', () => {
	const macro: PublicMacroDto = {
		id: 'macro-showstart',
		label: 'Show Start',
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		running: false,
		runnable: true,
		sortOrder: 0,
		runStartedAt: null,
		updatedAt: null,
	}

	it('dims an idle macro and lights a running one, exactly like a status', () => {
		const idle = getCompanionMacroButtonStyle(macro, false)
		const running = getCompanionMacroButtonStyle(macro, true)

		assert.equal(idle.bgcolor, 0x05420d)
		assert.equal(running.bgcolor, 0x0fcf29)
		assert.equal(idle.color, 0x101820)
		assert.equal(running.color, 0x101820)
		assert.equal(idle.size, 14)
	})

	it('uses the macro label verbatim', () => {
		assert.equal(getCompanionMacroButtonStyle({ ...macro, label: 'sys-green' }, false).text, 'sys-green')
	})

	it('falls back to a macro colour when CrewLAN sends an unusable one', () => {
		const broken = getCompanionMacroButtonStyle(
			{ ...macro, colors: { backgroundColor: 'nope', foregroundColor: 'nope' } },
			true,
		)

		assert.equal(broken.bgcolor, 0x8e24aa)
		assert.equal(broken.color, 0xffffff)
	})
})
