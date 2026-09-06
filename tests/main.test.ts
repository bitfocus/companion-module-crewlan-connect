import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InstanceStatus } from '@companion-module/base'
import { CrewLanApiError } from '../src/api.js'
import {
	computeReconnectDelayMs,
	describeAlert,
	feedbackIdsForGroups,
	isConnectionLevelError,
	nonRecoverableRetryDelayMs,
	pickFresher,
	reconnectBackoffMaxMs,
	statusForError,
} from '../src/main.js'

describe('reconnect backoff', () => {
	it('grows exponentially and is capped', () => {
		assert.equal(computeReconnectDelayMs(0, InstanceStatus.ConnectionFailure, 0.5), 1000)
		assert.equal(computeReconnectDelayMs(1, InstanceStatus.ConnectionFailure, 0.5), 2000)
		assert.equal(computeReconnectDelayMs(3, InstanceStatus.ConnectionFailure, 0.5), 8000)
		assert.equal(computeReconnectDelayMs(10, InstanceStatus.ConnectionFailure, 0.5), reconnectBackoffMaxMs)
	})

	it('adds bounded jitter', () => {
		assert.equal(computeReconnectDelayMs(2, InstanceStatus.ConnectionFailure, 0), 3200)
		assert.equal(computeReconnectDelayMs(2, InstanceStatus.ConnectionFailure, 1), 4800)
	})

	it('backs off to a long fixed interval for errors a retry cannot fix', () => {
		assert.equal(computeReconnectDelayMs(0, InstanceStatus.AuthenticationFailure, 0.5), nonRecoverableRetryDelayMs)
		assert.equal(computeReconnectDelayMs(4, InstanceStatus.BadConfig, 0.5), nonRecoverableRetryDelayMs)
	})
})

describe('pickFresher', () => {
	type Timed = { updatedAt: string | null; value: string }

	const older: Timed = { updatedAt: '2026-08-03T18:00:00.000Z', value: 'older' }
	const newer: Timed = { updatedAt: '2026-08-03T18:00:05.000Z', value: 'newer' }
	const untimed: Timed = { updatedAt: null, value: 'untimed' }

	it('takes the incoming payload when nothing is held', () => {
		assert.equal(pickFresher(null, older, 0, 100), older)
	})

	it('prefers the newer server timestamp regardless of request order', () => {
		assert.equal(pickFresher(newer, older, 500, 100), newer)
		assert.equal(pickFresher(older, newer, 0, 100), newer)
	})

	it('falls back to request ordering when timestamps are missing', () => {
		assert.equal(pickFresher(untimed, { ...untimed, value: 'poll' }, 50, 100).value, 'untimed')
		assert.equal(pickFresher(untimed, { ...untimed, value: 'poll' }, 100, 100).value, 'poll')
		assert.equal(pickFresher(older, untimed, 50, 100), older)
	})
})

describe('feedback groups', () => {
	it('maps each state slice to its feedbacks', () => {
		assert.deepEqual(feedbackIdsForGroups(new Set(['connection'])), ['connection_ok'])
		assert.deepEqual(feedbackIdsForGroups(new Set(['status'])), ['status_is', 'status_style'])
		assert.equal(feedbackIdsForGroups(new Set(['controls'])).length, 9)
		assert.deepEqual(feedbackIdsForGroups(new Set()), [])
	})
})

describe('error classification', () => {
	it('treats transport failures as connection-level', () => {
		assert.equal(isConnectionLevelError(new CrewLanApiError('down', null, 'network')), true)
		assert.equal(isConnectionLevelError(new CrewLanApiError('slow', null, 'timeout')), true)
		assert.equal(isConnectionLevelError(new TypeError('fetch failed')), true)
	})

	it('keeps HTTP and cancellation errors local to the action', () => {
		assert.equal(isConnectionLevelError(new CrewLanApiError('Entity access is required.', 401)), false)
		assert.equal(isConnectionLevelError(new CrewLanApiError('not found', 404)), false)
		assert.equal(isConnectionLevelError(new CrewLanApiError('cancelled', null, 'aborted')), false)
		assert.equal(isConnectionLevelError(new CrewLanApiError('not connected')), false)
	})

	it('maps transport and rate-limit errors to ConnectionFailure', () => {
		assert.equal(statusForError(new CrewLanApiError('down', null, 'network')), InstanceStatus.ConnectionFailure)
		assert.equal(statusForError(new CrewLanApiError('slow', null, 'timeout')), InstanceStatus.ConnectionFailure)
		assert.equal(statusForError(new CrewLanApiError('busy', 429)), InstanceStatus.ConnectionFailure)
		assert.equal(statusForError(new CrewLanApiError('bad', null, 'invalid-response')), InstanceStatus.ConnectionFailure)
	})
})

describe('alert descriptions', () => {
	it('names the scope and the time the alert arrived', () => {
		assert.equal(describeAlert('2026-08-03T18:44:41.000Z', 'workspace'), 'Workspace alert at 2026-08-03T18:44:41.000Z')
		assert.equal(
			describeAlert('2026-08-03T18:44:41.000Z', 'entities'),
			'Alert for this entity at 2026-08-03T18:44:41.000Z',
		)
	})

	it('stays readable when the event carries no timestamp', () => {
		assert.equal(describeAlert('', 'workspace'), 'Workspace alert at unknown time')
	})
})
