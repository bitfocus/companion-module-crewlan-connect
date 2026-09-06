import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InstanceStatus } from '@companion-module/base'
import { CrewLanApiError } from '../src/api.js'
import {
	authenticationFailedConnectionMessage,
	describeCompanionErrorForDisplay,
	isConfigurationError,
	statusForError,
} from '../src/main.js'

describe('Companion instance error display', () => {
	it('keeps authentication failures generic without token details', () => {
		const errors = [
			new CrewLanApiError('Invalid Public API token.', 401),
			new CrewLanApiError('The token does not grant this capability.', 403),
			new CrewLanApiError('The token must grant exactly one CrewLAN entity capability.'),
		]

		for (const error of errors) {
			assert.equal(statusForError(error), InstanceStatus.AuthenticationFailure)
			assert.equal(describeCompanionErrorForDisplay(error), authenticationFailedConnectionMessage)
			assert.doesNotMatch(describeCompanionErrorForDisplay(error), /token|capability/iu)
		}
	})

	it('keeps non-authentication errors descriptive', () => {
		const error = new CrewLanApiError('Address must start with http:// or https://.', null, 'config')

		assert.equal(statusForError(error), InstanceStatus.BadConfig)
		assert.equal(describeCompanionErrorForDisplay(error), error.message)
	})

	/**
	 * A connection that was never filled in must send the operator to the connection settings, not
	 * into CrewLAN to look for a token that was never rejected because it was never sent.
	 */
	it('reports a connection that is not configured as a bad configuration', () => {
		const error = new CrewLanApiError('Connection token is required.', null, 'config')

		assert.equal(statusForError(error), InstanceStatus.BadConfig)
		assert.equal(describeCompanionErrorForDisplay(error), 'Connection token is required.')
	})

	it('retries everything except an unusable connection configuration', () => {
		assert.ok(isConfigurationError(new CrewLanApiError('Connection token is required.', null, 'config')))
		assert.ok(isConfigurationError(new CrewLanApiError('Address is required.', null, 'config')))
		// These came from CrewLAN, so a retry can still succeed once it is set up there.
		assert.ok(!isConfigurationError(new CrewLanApiError('The token must grant exactly one CrewLAN entity capability.')))
		assert.ok(!isConfigurationError(new CrewLanApiError('Invalid Public API token.', 401)))
		assert.ok(!isConfigurationError(new Error('boom')))
	})
})
