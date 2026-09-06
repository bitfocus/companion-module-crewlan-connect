import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from '../src/main.js'
import type { ModuleSchema } from '../src/main.js'
import { UpdatePresets } from '../src/presets.js'
import type { PublicMacroDto, PublicStatusDto } from '../src/types.js'

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
			getRunnableMacros: () => [],
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

function createMacro(input: Partial<PublicMacroDto>): PublicMacroDto {
	return {
		id: 'macro-showstart',
		label: 'Show Start',
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		running: false,
		runnable: true,
		sortOrder: 0,
		runStartedAt: null,
		updatedAt: null,
		...input,
	}
}

describe('Companion macro presets', () => {
	function build(macros: PublicMacroDto[]): {
		presets: CompanionPresetDefinitions<ModuleSchema>
		structure: CompanionPresetSection<ModuleSchema>[]
	} {
		let capturedPresets: CompanionPresetDefinitions<ModuleSchema> | undefined
		let capturedStructure: CompanionPresetSection<ModuleSchema>[] | undefined
		const self = {
			getSelectableStatuses: () => [],
			getRunnableMacros: () => macros,
			setPresetDefinitions: (
				structure: CompanionPresetSection<ModuleSchema>[],
				presets: CompanionPresetDefinitions<ModuleSchema>,
			) => {
				capturedStructure = structure
				capturedPresets = presets
			},
		} as unknown as ModuleInstance

		UpdatePresets(self)
		assert.ok(capturedPresets)
		assert.ok(capturedStructure)

		return { presets: capturedPresets, structure: capturedStructure }
	}

	it('builds one dimmed button per macro that lights up while it runs', () => {
		const { presets, structure } = build([createMacro({})])
		const preset = presets['macro_macro-showstart']

		assert.ok(preset)
		assert.equal(preset.name, 'Macro: Show Start')
		assert.equal(preset.style.bgcolor, 0x05420d)
		assert.equal(preset.style.text, 'Show Start')

		const [step] = preset.steps
		assert.deepEqual(step?.down, [{ actionId: 'run_macro', options: { macroId: 'macro-showstart' } }])
		assert.deepEqual(step?.up, [])

		const [feedback] = preset.feedbacks
		assert.equal(feedback?.feedbackId, 'macro_running')
		assert.deepEqual(feedback?.options, { macroId: 'macro-showstart' })
		assert.equal(feedback?.style?.bgcolor, 0x0fcf29)

		assert.equal(structure[0]?.id, 'macros')
	})

	it('offers no macro section when CrewLAN publishes no macros', () => {
		const { presets, structure } = build([])

		assert.equal(
			Object.keys(presets).some((id) => id.startsWith('macro_')),
			false,
		)
		assert.equal(
			structure.some((section) => section.id === 'macros'),
			false,
		)
	})
})
