import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InstanceStatus } from '@companion-module/base'
import { CrewLanApiError } from '../src/api.js'
import { authenticationFailedConnectionMessage, describeCompanionErrorForDisplay, statusForError } from '../src/main.js'

describe('Companion instance error display', () => {
	it('keeps authentication failures generic without token details', () => {
		const errors = [
			new CrewLanApiError('Invalid Public API token.', 401),
			new CrewLanApiError('The token does not grant this capability.', 403),
			new CrewLanApiError('CrewLAN entity token is required.'),
			new CrewLanApiError('The token must grant exactly one CrewLAN entity capability.'),
		]

		for (const error of errors) {
			assert.equal(statusForError(error), InstanceStatus.AuthenticationFailure)
			assert.equal(describeCompanionErrorForDisplay(error), authenticationFailedConnectionMessage)
			assert.doesNotMatch(describeCompanionErrorForDisplay(error), /token|capability/iu)
		}
	})

	it('keeps non-authentication errors descriptive', () => {
		const error = new CrewLanApiError('Address must start with http:// or https://.')

		assert.equal(statusForError(error), InstanceStatus.BadConfig)
		assert.equal(describeCompanionErrorForDisplay(error), error.message)
	})
})
