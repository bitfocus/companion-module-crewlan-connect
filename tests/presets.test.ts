import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from '../src/main.js'
import type { ModuleSchema } from '../src/main.js'
import { UpdatePresets } from '../src/presets.js'
import type { PublicStatusDto } from '../src/types.js'

function createStatus(input: Partial<PublicStatusDto>): PublicStatusDto {
	return {
		id: 'sys-idle',
		kind: 'system',
		label: 'Idle',
		paletteKey: 'blue',
		colors: {
			backgroundColor: '#0fcf29',
			foregroundColor: '#101820',
		},
		alertType: null,
		motionPreset: 'none',
		selectable: true,
		...input,
	}
}

describe('Companion presets', () => {
	it('builds status presets with dimmed inactive style and full active feedback style', () => {
		let capturedPresets: CompanionPresetDefinitions<ModuleSchema> | undefined
		let capturedStructure: CompanionPresetSection<ModuleSchema>[] | undefined
		const status = createStatus({ id: 'sys-idle', label: 'Idle' })
		const self = {
			getSelectableStatuses: () => [status],
			setPresetDefinitions: (
				structure: CompanionPresetSection<ModuleSchema>[],
				presets: CompanionPresetDefinitions<ModuleSchema>,
			) => {
				capturedStructure = structure
				capturedPresets = presets
			},
		} as unknown as ModuleInstance

		UpdatePresets(self)

		assert.ok(capturedStructure)
		assert.ok(capturedPresets)
		assert.equal(capturedStructure[0]?.id, 'status')

		const preset = capturedPresets['status_sys-idle']
		assert.ok(preset)
		assert.equal(preset.name, 'Status: Standby')
		assert.equal(preset.style.bgcolor, 0x05420d)
		assert.equal(preset.style.color, 0x101820)

		const [feedback] = preset.feedbacks
		assert.ok(feedback)
		assert.equal(feedback.feedbackId, 'status_is')
		assert.deepEqual(feedback.options, { statusId: 'sys-idle' })
		assert.ok(feedback.style)
		assert.equal(feedback.style.bgcolor, 0x0fcf29)
		assert.equal(feedback.style.color, 0x101820)
		assert.equal(feedback.style.text, 'Standby')
	})
})
