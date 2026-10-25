import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { InstanceStatus } from '@companion-module/base'
import { CrewLanApiClient, CrewLanApiError, ServerSentEventParser } from '../src/api.js'
import {
	CrewLanV2Client,
	endedError,
	foregroundFor,
	probeIntegrationApi,
	toIntercomState,
	toPublicControls,
	toPublicStatus,
	toV1StatusId,
	toV2StatusId,
} from '../src/api-v2.js'
import {
	computeReconnectDelayMs,
	describeCompanionErrorForDisplay,
	isOwnerAbsentError,
	statusForError,
} from '../src/main.js'
import type { IntegrationIntercomControls, IntegrationEventEnvelope, PublicEventEnvelope } from '../src/types.js'

const silent = { debug: () => undefined, warn: () => undefined }

const controls: IntegrationIntercomControls = {
	inputMuted: false,
	outputMuted: true,
	globalTalk: { held: true, talkKey: 'latch' },
	groupTalk: [{ groupId: 'grp-stage', talkKey: 'push' }],
	call: null,
	ringing: [{ callerId: 'ent-bob' }],
	audio: { connected: true, sending: true },
	changedAt: '2026-10-25T20:00:00.000Z',
}

describe('v2 translation', () => {
	it('names each built-in status by its v1 id both ways and leaves custom ids alone', () => {
		for (const [modern, legacy] of [
			['ready', 'sys-green'],
			['attention', 'sys-yellow'],
			['critical', 'sys-red'],
			['standby', 'sys-idle'],
			['offline', 'sys-offline'],
		]) {
			assert.equal(toV1StatusId(modern as string), legacy)
			assert.equal(toV2StatusId(legacy as string), modern)
		}

		assert.equal(toV1StatusId('sts-0011'), 'sts-0011')
		assert.equal(toV2StatusId('sts-0011'), 'sts-0011')
	})

	it('picks the foreground v1 picks', () => {
		for (const [background, expected] of [
			['#ffffff', '#000000'],
			['#ffd60a', '#000000'],
			['#000000', '#ffffff'],
			['#1d71c7', '#ffffff'],
			['not a colour', '#ffffff'],
		]) {
			assert.equal(foregroundFor(background as string), expected, background)
		}
	})

	it('writes a built-in status with its English name and a custom one with its label', () => {
		assert.deepEqual(
			toPublicStatus({
				id: 'ready',
				builtIn: true,
				label: null,
				color: '#30D158',
				animation: 'none',
				selectable: true,
			}),
			{
				id: 'sys-green',
				kind: 'system',
				label: 'OK',
				colors: { backgroundColor: '#30d158', foregroundColor: '#ffffff' },
				motionPreset: 'none',
				selectable: true,
			},
		)
		assert.equal(
			toPublicStatus({ id: 'sts-1', builtIn: false, label: 'On air', color: '#FF0000', selectable: true }).label,
			'On air',
		)
	})

	it('maps Output to v1 listen and Global Talk to v1 talk, unavailable during a call', () => {
		assert.deepEqual(toPublicControls('ent-1', controls), {
			entityId: 'ent-1',
			shoutbox: {
				listen: { enabled: true, muted: true, available: true },
				talk: { enabled: true, active: true, live: true, controlMode: 'latch', available: true },
			},
			updatedAt: '2026-10-25T20:00:00.000Z',
		})
		assert.equal(
			toPublicControls('ent-1', { ...controls, call: { callerId: 'ent-bob' } }).shoutbox.talk.available,
			false,
		)
	})

	it('keeps the member groups, the Everyone group first and named All, with the callers named', () => {
		const state = toIntercomState(
			'ent-1',
			[
				{ id: 'grp-stage', name: 'Stage', everyone: false, members: ['ent-1'], listening: { gainDb: -6, muted: true } },
				{ id: 'grp-foh', name: 'FOH', everyone: false, members: ['ent-2'], listening: null },
				{ id: 'everyone', name: null, everyone: true, members: ['ent-1', 'ent-2'], listening: null },
			],
			controls,
			new Map([['ent-bob', 'Bob · Camera 1']]),
		)

		assert.deepEqual(
			state.groups.map((group) => [group.id, group.name, group.muted, group.gainDb, group.talkHeld, group.talkKey]),
			[
				['everyone', 'All', false, 0, false, null],
				['grp-stage', 'Stage', true, -6, true, 'push'],
			],
		)
		assert.deepEqual(state.ringing, [{ id: 'ent-bob', name: 'Bob · Camera 1' }])
		assert.equal(state.call, null)
		assert.equal(state.audioConnected, true)
	})

	it('reads event: gap and event: ended as named frames', () => {
		const parser = new ServerSentEventParser()
		const frames = parser.pushFrames(
			'id: evt-1\ndata: {"a":1}\n\nevent: gap\ndata: {}\n\n: heartbeat\nevent: ended\ndata: {"code":"connection_paused"}\n\n',
		)

		assert.deepEqual(frames, [
			{ event: 'message', data: '{"a":1}' },
			{ event: 'gap', data: '{}' },
			{ event: 'ended', data: '{"code":"connection_paused"}' },
		])
	})

	it('classifies the codes an ended stream names', () => {
		assert.equal(statusForError(endedError('connection_paused')), InstanceStatus.AuthenticationFailure)
		assert.equal(statusForError(endedError('connection_unknown')), InstanceStatus.AuthenticationFailure)
		assert.equal(statusForError(endedError('address_blocked')), InstanceStatus.AuthenticationFailure)
		assert.equal(statusForError(endedError('something_else')), InstanceStatus.ConnectionFailure)
	})

	it('reads 401 connection_owner_absent as an absent owner, not a refused token', () => {
		assert.equal(isOwnerAbsentError(new CrewLanApiError('absent', 401, 'http', 'connection_owner_absent')), true)
		assert.equal(isOwnerAbsentError(new CrewLanApiError('unknown', 401, 'http', 'connection_unknown')), false)
	})

	it("shows v1's compatibility_mode_off as an authentication failure with CrewLAN's sentence, retried after 60 s", () => {
		const sentence =
			'the v1 compatibility mode is off in this Workspace: an administrator switches it on in Administration, under Connections'
		const error = new CrewLanApiError(sentence, 403, 'http', 'forbidden')

		assert.equal(statusForError(error), InstanceStatus.AuthenticationFailure)
		assert.match(describeCompanionErrorForDisplay(error), /authentication failed\. the v1 compatibility mode is off/u)
		assert.equal(computeReconnectDelayMs(0, statusForError(error)), 60_000)
	})
})

interface Recorded {
	method: string
	path: string
	body: unknown
}

describe('v2 client against a fake /api/v2', () => {
	let server: http.Server
	let baseUrl = ''
	const recorded: Recorded[] = []
	let answerProbe = 200
	let streamResponse: http.ServerResponse | null = null

	before(async () => {
		server = http.createServer((request, response) => {
			let text = ''
			request.on('data', (chunk: Buffer) => (text += chunk.toString()))
			request.on('end', () => {
				const path = request.url ?? ''
				recorded.push({ method: request.method ?? '', path, body: text.length > 0 ? JSON.parse(text) : null })
				const json = (status: number, body: unknown): void => {
					response.writeHead(status, { 'content-type': 'application/json' })
					response.end(JSON.stringify(body))
				}

				if (path === '/api/v2') {
					if (answerProbe === 404) {
						json(404, { error: 'not_found', message: 'not found' })
					} else if (answerProbe === 401) {
						json(401, { error: 'connection_unknown', message: 'no connection has this token' })
					} else if (answerProbe === 429) {
						json(429, { error: 'connection_rate_limited', message: 'too many requests' })
					} else if (answerProbe === 2000) {
						response.writeHead(200, { 'content-type': 'text/html' })
						response.end('<!doctype html><title>Proxy</title>')
					} else {
						json(200, {
							data: { api: 'v2', limits: {}, requests: [{ wireId: 'macros.command.runMacro' }], events: [] },
						})
					}
					return
				}

				if (path.startsWith('/api/v2/events')) {
					response.writeHead(200, { 'content-type': 'text/event-stream' })
					response.write(': open\n\n')
					streamResponse = response
					return
				}

				if (path === '/api/v2/requests/status.command.setEntityStatus') {
					json(200, {
						data: {
							entityId: 'ent-1',
							statusId: 'attention',
							chosenStatusId: 'attention',
							since: null,
							changedAt: '2026-10-25T20:00:01.000Z',
						},
					})
					return
				}

				if (path === '/api/v2/requests/intercom.command.setControls') {
					json(200, { data: controls })
					return
				}

				if (path === '/api/v2/requests/alerts.command.acknowledgeAlerts') {
					json(200, { data: { acknowledged: ['alr-1', 'alr-2'], reopened: [] } })
					return
				}

				if (path === '/api/v2/requests/intercom.command.setListening') {
					json(401, {
						error: 'connection_owner_absent',
						message: 'this connection acts only while its participant is signed in at a Client, and they are not',
					})
					return
				}

				json(404, { error: 'not_found', message: 'no' })
			})
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
	})

	after(async () => {
		streamResponse?.end()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	})

	it('probes /api/v2 and takes 404 as the Public API v1', async () => {
		const client = new CrewLanApiClient({ baseUrl, token: 'con_test', logger: silent })

		assert.notEqual(await probeIntegrationApi(client), null)
		answerProbe = 404
		assert.equal(await probeIntegrationApi(client), null)
		// A refusal is the connection's own and fails it; read as v1 it would be misnamed.
		answerProbe = 401
		await assert.rejects(probeIntegrationApi(client), (error: unknown) => {
			return error instanceof CrewLanApiError && error.statusCode === 401 && error.code === 'connection_unknown'
		})
		answerProbe = 429
		await assert.rejects(probeIntegrationApi(client), (error: unknown) => {
			return error instanceof CrewLanApiError && error.statusCode === 429
		})
		// A success that is no v2 description — a proxy's HTML page — is the Public API v1 path.
		answerProbe = 2000
		assert.equal(await probeIntegrationApi(client), null)
		answerProbe = 200
	})

	it('sends each write as its request body', async () => {
		const http1 = new CrewLanApiClient({ baseUrl, token: 'con_test', logger: silent })
		const client = new CrewLanV2Client(http1, { api: 'v2', requests: [] }, silent)
		recorded.length = 0

		const status = await client.setEntityStatus('ent-1', 'sys-yellow')
		assert.equal(status.selectedStatusId, 'sys-yellow')
		await client.patchEntityControls('ent-1', { shoutbox: { listen: { muted: true } } })
		await client.patchEntityControls('ent-1', { shoutbox: { talk: { active: true, controlMode: 'push' } } })
		await client.patchEntityControls('ent-1', { shoutbox: { talk: { active: false, controlMode: null } } })
		await client.setControls('ent-1', { groupTalk: { groupId: 'grp-stage', held: true, talkKey: 'latch' } })
		await client.setControls('ent-1', { call: null })
		assert.deepEqual(await client.dismissEntityAlerts('ent-1'), { entityId: 'ent-1', dismissedCount: 2 })

		assert.deepEqual(
			recorded.map((entry) => [entry.path.replace('/api/v2/requests/', ''), entry.body]),
			[
				['status.command.setEntityStatus', { entityId: 'ent-1', statusId: 'attention' }],
				['intercom.command.setControls', { outputMuted: true }],
				['intercom.command.setControls', { globalTalk: true, talkKey: 'push' }],
				['intercom.command.setControls', { globalTalk: false }],
				['intercom.command.setControls', { groupTalk: { groupId: 'grp-stage', held: true, talkKey: 'latch' } }],
				['intercom.command.setControls', { call: null }],
				['alerts.command.acknowledgeAlerts', { allOpen: true }],
			],
		)
		assert.ok(recorded.every((entry) => entry.method === 'POST'))
	})

	it('carries the refusal code, so an absent owner is told apart', async () => {
		const client = new CrewLanV2Client(
			new CrewLanApiClient({ baseUrl, token: 'con_test', logger: silent }),
			{ api: 'v2', requests: [] },
			silent,
		)

		await assert.rejects(client.setListening('everyone', true), (error: unknown) => isOwnerAbsentError(error))
	})

	it('hands on v1-shaped events, the others, a gap, and ends on event: ended', async () => {
		const client = new CrewLanV2Client(
			new CrewLanApiClient({ baseUrl, token: 'con_test', logger: silent }),
			{ api: 'v2', requests: [] },
			silent,
		)
		const translated: PublicEventEnvelope[] = []
		const other: IntegrationEventEnvelope[] = []
		let gaps = 0
		const abort = new AbortController()
		const stream = client.streamEvents({
			signal: abort.signal,
			onEvent: (event) => translated.push(event),
			onIntegrationEvent: (event) => other.push(event),
			onGap: () => (gaps += 1),
		})

		while (streamResponse === null) {
			await new Promise((resolve) => setTimeout(resolve, 10))
		}

		const envelope = (wireId: string, payload: object): string =>
			`id: evt-${wireId}\ndata: ${JSON.stringify({ id: 'evt', wireId, occurredAt: '2026-10-25T20:00:00.000Z', payload })}\n\n`
		streamResponse.write(envelope('macros.event.macroRemoved', { macroId: 'mac-1', name: 'Doors' }))
		streamResponse.write(envelope('macros.event.macroRunStarted', { macroId: 'mac-2', runId: 'run-1' }))
		streamResponse.write(envelope('alerts.event.alertRaised', { alertId: 'alr-1', entityId: 'ent-1' }))
		streamResponse.write('event: gap\ndata: {}\n\n')
		streamResponse.write('event: ended\ndata: {"code":"connection_paused"}\n\n')

		await assert.rejects(stream, (error: unknown) => statusForError(error) === InstanceStatus.AuthenticationFailure)
		assert.deepEqual(
			translated.map((event) => [event.type, event.data]),
			[
				['macro.removed', { id: 'mac-1' }],
				['alert.triggered', { scope: 'entities', targetEntityIds: ['ent-1'] }],
			],
		)
		assert.deepEqual(
			other.map((event) => event.wireId),
			['macros.event.macroRunStarted'],
		)
		assert.equal(gaps, 1)
		assert.ok(recorded.some((entry) => entry.path.startsWith('/api/v2/events?types=status.event.entityStatusChanged,')))
		abort.abort()
		streamResponse = null
	})
})
