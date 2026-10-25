import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import ModuleInstance from '../src/main.js'
import type { IntegrationIntercomControls } from '../src/types.js'

/** The module against a fake Workspace serving `/api/v2`, as `instance.test.ts` fakes v1. */

interface Fake {
	port: number
	requests: Array<{ path: string; body: unknown }>
	controls: IntegrationIntercomControls
	groups: object[]
	participants: object[]
	/** When true a controls read answers after 600 ms, and `controlsInFlight` counts those open. */
	slowControls: boolean
	controlsInFlight: number
	/** What the snapshot says of mac-1's run, and how long it takes to answer. */
	snapshotMacroRunning: boolean
	snapshotDelayMs: number
	statusId: string
	/** Per wire id: a refusal to answer instead of the outcome. */
	refuse: Map<string, { status: number; error: string; message: string }>
	send(frame: string): void
	event(wireId: string, payload: object): void
	streams: number
	close(): Promise<void>
}

const status = (id: string, color: string): object => ({
	id,
	builtIn: true,
	label: null,
	color,
	animation: 'none',
	selectable: id !== 'offline',
	updatedAt: null,
})

async function startFake(): Promise<Fake> {
	let stream: http.ServerResponse | null = null
	const fake: Fake = {
		port: 0,
		requests: [],
		controls: {
			inputMuted: false,
			outputMuted: false,
			globalTalk: { held: false, talkKey: null },
			groupTalk: [],
			call: null,
			ringing: [{ callerId: 'ent-bob' }],
			audio: { connected: true, sending: false },
			changedAt: '2026-10-25T20:00:00.000Z',
		},
		groups: [
			{ id: 'everyone', name: null, everyone: true, members: ['ent-1', 'ent-bob'], listening: null },
			{ id: 'grp-stage', name: 'Stage', everyone: false, members: ['ent-1'], listening: { gainDb: -6, muted: false } },
		],
		participants: [
			{ id: 'ent-1', displayIdentity: 'Desk', held: true },
			{ id: 'ent-bob', displayIdentity: 'Bob', held: true },
		],
		slowControls: false,
		controlsInFlight: 0,
		snapshotMacroRunning: false,
		snapshotDelayMs: 0,
		statusId: 'ready',
		refuse: new Map(),
		send: (frame) => stream?.write(frame),
		event: (wireId, payload) =>
			stream?.write(
				`id: evt-1\ndata: ${JSON.stringify({ id: 'evt-1', wireId, occurredAt: new Date().toISOString(), payload })}\n\n`,
			),
		streams: 0,
		close: async () => {
			stream?.end()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
	const server = http.createServer((request, response) => {
		let text = ''
		request.on('data', (chunk: Buffer) => (text += chunk.toString()))
		request.on('end', () => {
			const path = request.url ?? ''
			fake.requests.push({ path, body: text.length > 0 ? JSON.parse(text) : null })
			const json = (code: number, body: unknown): void => {
				response.writeHead(code, { 'content-type': 'application/json' })
				response.end(JSON.stringify(body))
			}
			const wireId = path.replace('/api/v2/requests/', '')
			const refusal = fake.refuse.get(wireId)

			if (refusal !== undefined) {
				json(refusal.status, { error: refusal.error, message: refusal.message })
				return
			}

			switch (path) {
				case '/api/v2':
					json(200, { data: { api: 'v2', limits: {}, requests: [{ wireId: 'macros.command.runMacro' }], events: [] } })
					return
				case '/api/v2/requests/macros.command.runMacro':
					// A fast run: it starts and ends before its answer, which still says it runs.
					fake.event('macros.event.macroRunStarted', { macroId: 'mac-1', runId: 'run-9' })
					fake.event('macros.event.macroRunEnded', { macroId: 'mac-1', runId: 'run-9', outcome: 'completed' })
					setTimeout(
						() =>
							json(200, {
								data: {
									id: 'mac-1',
									name: 'Doors',
									color: '#1D71C7',
									running: true,
									runStartedAt: new Date().toISOString(),
									updatedAt: null,
									runnable: true,
								},
							}),
						80,
					)
					return
				case '/api/v2/snapshot': {
					const running = fake.snapshotMacroRunning
					setTimeout(
						() =>
							json(200, {
								data: {
									workspace: { id: 'wsp-1', name: 'Show', timeZone: 'Europe/Berlin' },
									connection: { id: 'con-1', name: 'Companion', access: 'act' },
									entity: { id: 'ent-1', displayIdentity: 'Desk', protected: false },
									participants: fake.participants,
									statuses: {
										statuses: [
											status('ready', '#30D158'),
											status('attention', '#FFD60A'),
											status('offline', '#4D5968'),
										],
										former: [],
										entities: [
											{
												entityId: 'ent-1',
												statusId: fake.statusId,
												chosenStatusId: 'ready',
												since: null,
												changedAt: '2026-10-25T20:00:00.000Z',
											},
										],
										indicators: [],
										formerIndicators: [],
										limits: {},
									},
									macros: [
										{
											id: 'mac-1',
											name: 'Doors',
											color: '#1D71C7',
											running,
											runStartedAt: null,
											updatedAt: null,
											runnable: true,
										},
									],
								},
							}),
						fake.snapshotDelayMs,
					)
					return
				}
				case '/api/v2/requests/intercom.query.getControls':
					if (fake.slowControls) {
						fake.controlsInFlight++
						setTimeout(() => {
							fake.controlsInFlight--
							json(200, { data: fake.controls })
						}, 600)
						return
					}
					json(200, { data: fake.controls })
					return
				case '/api/v2/requests/intercom.command.setControls':
					json(200, { data: fake.controls })
					return
				case '/api/v2/requests/intercom.query.listGroups':
				case '/api/v2/requests/intercom.command.setListening':
					json(200, { data: { groups: fake.groups, former: [], direct: [] } })
					return
				case '/api/v2/requests/status.command.setEntityStatus':
					json(200, {
						data: {
							entityId: 'ent-1',
							statusId: 'attention',
							chosenStatusId: 'attention',
							since: null,
							changedAt: new Date().toISOString(),
						},
					})
					return
				default:
			}

			if (path.startsWith('/api/v2/events')) {
				fake.streams += 1
				response.writeHead(200, { 'content-type': 'text/event-stream' })
				response.write(': open\n\n')
				stream = response
				return
			}

			json(404, { error: 'not_found', message: 'not served' })
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	fake.port = (server.address() as AddressInfo).port
	return fake
}

interface Host {
	instance: ModuleInstance
	variables: Record<string, unknown>
	presets: string[]
	registrations: number
	status: string | null
	logs: string[]
}

function createHost(): Host {
	const host: Host = {
		instance: null as unknown as ModuleInstance,
		variables: {},
		presets: [],
		registrations: 0,
		status: null,
		logs: [],
	}
	const context = {
		id: 'test',
		label: 'test',
		_isInstanceContext: true,
		saveConfig: () => undefined,
		setActionDefinitions: () => undefined,
		setFeedbackDefinitions: () => undefined,
		setPresetDefinitions: (_structure: unknown, presets: Record<string, unknown>) => {
			host.presets = Object.keys(presets)
			host.registrations += 1
		},
		setVariableDefinitions: () => undefined,
		setVariableValues: (values: Record<string, unknown>) => Object.assign(host.variables, values),
		getVariableValue: (key: string) => host.variables[key],
		checkAllFeedbacks: () => undefined,
		checkFeedbacks: () => undefined,
		checkFeedbacksById: () => undefined,
		subscribeActions: () => undefined,
		unsubscribeActions: () => undefined,
		unsubscribeFeedbacks: () => undefined,
		recordAction: () => undefined,
		oscSend: () => undefined,
		updateStatus: (code: string, message?: string | null) => {
			host.status = code
			host.logs.push(`status:${code}${message === null || message === undefined ? '' : ` ${message}`}`)
		},
	}
	;(globalThis as { COMPANION_LOGGER?: unknown }).COMPANION_LOGGER = (
		_prefix: string,
		level: string,
		message: string,
	) => host.logs.push(`${level}: ${message}`)
	host.instance = new ModuleInstance(context)
	return host
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		if (condition()) {
			return
		}

		await sleep(20)
	}

	assert.fail(`timed out waiting for ${what}`)
}

describe('module against a Workspace serving /api/v2', () => {
	let fake: Fake
	let host: Host
	const bodies = (wireId: string): unknown[] =>
		fake.requests.filter((request) => request.path === `/api/v2/requests/${wireId}`).map((request) => request.body)

	before(async () => {
		fake = await startFake()
		host = createHost()
		await host.instance.init({ baseUrl: `http://127.0.0.1:${String(fake.port)}`, pollIntervalMs: 1000 }, true, {
			entityToken: 'con_test',
		})
		await waitFor(() => host.status === 'ok', 'the connection to report ok')
		await waitFor(() => fake.streams > 0, 'the event stream to open')
	})

	after(async () => {
		await host.instance.destroy()
		await fake.close()
	})

	it('speaks /api/v2 alone and translates it into the v1 state', () => {
		const state = host.instance.getCrewLanState()

		assert.equal(state.api, 'v2')
		assert.equal(fake.requests.filter((request) => request.path.startsWith('/api/v1')).length, 0)
		assert.deepEqual(
			state.statuses.map((entry) => [entry.id, entry.label]),
			[
				['sys-green', 'OK'],
				['sys-yellow', 'Attention'],
				['sys-offline', 'Offline'],
			],
		)
		assert.equal(state.status?.status.id, 'sys-green')
		assert.equal(state.ownerPresent, true)
		assert.equal(state.controls?.shoutbox.talk.available, true)
		assert.deepEqual(
			state.intercom?.groups.map((group) => [group.id, group.name]),
			[
				['everyone', 'All'],
				['grp-stage', 'Stage'],
			],
		)
		assert.deepEqual(state.intercom?.ringing, [{ id: 'ent-bob', name: 'Bob' }])
		assert.deepEqual(
			state.macros.map((macro) => [macro.id, macro.runnable, macro.colors.foregroundColor]),
			[['mac-1', true, '#ffffff']],
		)
		assert.ok(host.presets.includes('group_grp-stage_talk_push'), host.presets.join(','))
		assert.ok(fake.requests.some((request) => request.path.startsWith('/api/v2/events?types=')))
	})

	it('writes status, Output, Global Talk, Input, a group, a call and alerts as v2 requests', async () => {
		await host.instance.setCrewLanStatus('sys-yellow')
		await host.instance.setListenMuteMode('on')
		await host.instance.setTalkState(true, 'push')
		await host.instance.setTalkState(false, 'push')
		await host.instance.setInputMuteMode('toggle')
		await host.instance.setGroupTalk('grp-stage', true, 'latch')
		await host.instance.setGroupTalk('grp-stage', false, 'latch')
		await host.instance.setGroupMuteMode('grp-stage', 'on')
		await host.instance.answerCall()
		await host.instance.hangUpCall()

		assert.deepEqual(bodies('status.command.setEntityStatus'), [{ entityId: 'ent-1', statusId: 'attention' }])
		assert.deepEqual(bodies('intercom.command.setControls'), [
			{ outputMuted: true },
			{ globalTalk: true, talkKey: 'push' },
			{ globalTalk: false },
			{ inputMuted: true },
			{ groupTalk: { groupId: 'grp-stage', held: true, talkKey: 'latch' } },
			{ groupTalk: { groupId: 'grp-stage', held: false } },
			{ call: { callerId: 'ent-bob' } },
			{ call: null },
		])
		assert.deepEqual(bodies('intercom.command.setListening'), [{ groupId: 'grp-stage', muted: true }])
		assert.equal(host.instance.getCrewLanState().status?.status.id, 'sys-yellow')
	})

	it('logs a refused group write with its reason and keeps the connection', async () => {
		fake.refuse.set('intercom.command.setControls', {
			status: 409,
			error: 'intercom_in_call',
			message: 'Talk is not available during a direct call.',
		})
		await host.instance.runCrewLanAction('Group Talk', async () =>
			host.instance.setGroupTalk('grp-stage', true, 'push'),
		)
		fake.refuse.delete('intercom.command.setControls')

		assert.ok(host.logs.some((line) => line === 'error: Group Talk: Talk is not available during a direct call.'))
		await host.instance.runCrewLanAction('Group Talk', async () => host.instance.setGroupTalk('grp-gone', true, 'push'))
		assert.ok(
			host.logs.some((line) => line.startsWith('error: Talk: you are not a member of the intercom group "grp-gone"')),
		)
		assert.equal(host.status, 'ok')
	})

	it('keeps the connection up while the owner is absent and greys until they are present', async () => {
		fake.refuse.set('intercom.command.setListening', {
			status: 401,
			error: 'connection_owner_absent',
			message: 'this connection acts only while its participant is signed in at a Client, and they are not',
		})
		await host.instance.runCrewLanAction('Group mute', async () => host.instance.setGroupMuteMode('everyone', 'on'))
		fake.refuse.delete('intercom.command.setListening')

		assert.equal(host.instance.getCrewLanState().ownerPresent, false)
		assert.equal(host.status, 'ok')
		fake.event('status.event.entityStatusChanged', {
			entityId: 'ent-1',
			statusId: 'ready',
			chosenStatusId: 'ready',
			previousStatusId: 'offline',
			cause: 'presence',
			since: new Date().toISOString(),
			changedAt: new Date().toISOString(),
		})
		await waitFor(() => host.instance.getCrewLanState().ownerPresent, 'the owner to be present again')
		fake.event('status.event.entityStatusChanged', {
			entityId: 'ent-1',
			statusId: 'offline',
			chosenStatusId: 'ready',
			previousStatusId: 'ready',
			cause: 'presence',
			since: new Date().toISOString(),
			changedAt: new Date(Date.now() + 1000).toISOString(),
		})
		await waitFor(() => !host.instance.getCrewLanState().ownerPresent, 'an offline status to grey the buttons')
	})

	it('holds the grey after a refusal through a snapshot read inside the presence grace', async () => {
		fake.controls = { ...fake.controls, audio: { connected: false, sending: false } }
		// The previous test's Offline carries a time 1 s ahead; this status must come after it.
		await sleep(1100)
		fake.event('status.event.entityStatusChanged', {
			entityId: 'ent-1',
			statusId: 'ready',
			chosenStatusId: 'ready',
			previousStatusId: 'offline',
			cause: 'presence',
			since: new Date().toISOString(),
			changedAt: new Date().toISOString(),
		})
		await waitFor(() => host.instance.getCrewLanState().ownerPresent, 'the owner to be present')
		fake.refuse.set('intercom.command.setControls', {
			status: 401,
			error: 'connection_owner_absent',
			message: 'this connection acts only while its participant is signed in at a Client, and they are not',
		})
		await host.instance.runCrewLanAction('Input Mute', async () => host.instance.setInputMuteMode('on'))
		fake.refuse.delete('intercom.command.setControls')
		assert.equal(host.instance.getCrewLanState().ownerPresent, false)

		// The snapshot still shows the chosen status, changed before the refusal: no sign of presence.
		const instance = host.instance as unknown as { generation: number; runPoll(generation: number): Promise<void> }
		await instance.runPoll(instance.generation)
		await sleep(1200)
		assert.notEqual(host.instance.getCrewLanState().status?.status.id, 'sys-offline')
		assert.equal(host.instance.getCrewLanState().ownerPresent, false)

		// An audio connection is a Client of the Entity attached.
		fake.controls = {
			...fake.controls,
			audio: { connected: true, sending: false },
			changedAt: new Date().toISOString(),
		}
		await waitFor(() => host.instance.getCrewLanState().ownerPresent, 'the audio connection to show presence')
	})

	it('reads the controls every second, since no event announces the audio connection', async () => {
		fake.controls = { ...fake.controls, audio: { connected: true, sending: true }, changedAt: new Date().toISOString() }
		await waitFor(() => host.variables.talk_live === true, 'the microphone to read live', 3000)
		fake.controls = {
			...fake.controls,
			audio: { connected: false, sending: false },
			changedAt: new Date().toISOString(),
		}
		await waitFor(
			() => host.instance.getCrewLanState().intercom?.audioConnected === false && host.variables.talk_live === false,
			'the audio connection to read closed',
			3000,
		)
		fake.controls = {
			...fake.controls,
			audio: { connected: true, sending: false },
			changedAt: new Date().toISOString(),
		}
		await waitFor(
			() => host.instance.getCrewLanState().intercom?.audioConnected === true,
			'the audio connection again',
			3000,
		)
	})

	it('names a caller who joined after the snapshot by reading it again, once', async () => {
		const snapshots = () => fake.requests.filter((request) => request.path === '/api/v2/snapshot').length
		fake.participants = [...fake.participants, { id: 'ent-carol', displayIdentity: 'Carol', held: true }]
		const before = snapshots()
		fake.controls = {
			...fake.controls,
			ringing: [{ callerId: 'ent-carol' }],
			call: null,
			changedAt: new Date().toISOString(),
		}

		await waitFor(() => host.variables.intercom_ringing_caller === 'Carol', 'the new caller to be named', 3000)
		// Two more controls reads name nobody new, so the snapshot is not read again.
		await sleep(2200)
		assert.equal(snapshots(), before + 1)
		fake.controls = { ...fake.controls, ringing: [{ callerId: 'ent-bob' }], changedAt: new Date().toISOString() }
	})

	it('toggles a group mute from a fresh read of the groups, which no event announces', async () => {
		const [everyone, stage] = fake.groups as [object, { listening: { gainDb: number; muted: boolean } }]
		await sleep(1100)
		// A Client muted Stage; the module last read it unmuted.
		fake.groups = [everyone, { ...stage, listening: { ...stage.listening, muted: true } }]
		assert.equal(host.instance.getCrewLanState().intercom?.groups[1]?.muted, false)

		await host.instance.setGroupMuteMode('grp-stage', 'toggle')

		assert.deepEqual(bodies('intercom.command.setListening').at(-1), { groupId: 'grp-stage', muted: false })
		fake.groups = [everyone, stage]
	})

	it('keeps a run event over a snapshot that was asked for before it', async () => {
		fake.event('macros.event.macroRunStarted', { macroId: 'mac-1', runId: 'run-7' })
		await waitFor(() => host.instance.isMacroRunning('mac-1'), 'the macro to run')
		// A snapshot read while it ran answers after its macroRunEnded.
		fake.snapshotMacroRunning = true
		fake.snapshotDelayMs = 200
		fake.send('event: gap\ndata: {}\n\n')
		await sleep(50)
		fake.event('macros.event.macroRunEnded', { macroId: 'mac-1', runId: 'run-7', outcome: 'completed' })
		fake.snapshotMacroRunning = false
		fake.snapshotDelayMs = 0
		await sleep(600)
		assert.equal(host.instance.isMacroRunning('mac-1'), false)
	})

	it('dims a fast macro whose run ended before its answer arrived', async () => {
		await host.instance.runCrewLanAction('Run Macro', async () => host.instance.runCrewLanMacro('mac-1'))
		await sleep(200)
		assert.equal(host.instance.isMacroRunning('mac-1'), false)
	})

	it('lifts a refusal on any frame of the stream but the bound Entity’s own Offline', async () => {
		fake.controls = { ...fake.controls, audio: { connected: false, sending: false } }
		const refuse = async () => {
			fake.refuse.set('intercom.command.setControls', {
				status: 401,
				error: 'connection_owner_absent',
				message: 'this connection acts only while its participant is signed in at a Client, and they are not',
			})
			await host.instance.runCrewLanAction('Input Mute', async () => host.instance.setInputMuteMode('on'))
			fake.refuse.delete('intercom.command.setControls')
			assert.equal(host.instance.getCrewLanState().ownerPresent, false)
		}

		await refuse()
		// The bound Entity's own Offline is no sign of presence.
		fake.event('status.event.entityStatusChanged', {
			entityId: 'ent-1',
			statusId: 'offline',
			chosenStatusId: 'ready',
			previousStatusId: 'ready',
			cause: 'presence',
			since: new Date().toISOString(),
			changedAt: new Date().toISOString(),
		})
		await sleep(300)
		assert.equal(host.instance.getCrewLanState().ownerPresent, false)
		fake.event('status.event.entityStatusChanged', {
			entityId: 'ent-1',
			statusId: 'ready',
			chosenStatusId: 'ready',
			previousStatusId: 'offline',
			cause: 'presence',
			since: new Date().toISOString(),
			changedAt: new Date(Date.now() + 1000).toISOString(),
		})
		await waitFor(() => host.instance.getCrewLanState().ownerPresent, 'the owner to be present again')

		await refuse()
		fake.send('event: gap\ndata: {}\n\n')
		await waitFor(() => host.instance.getCrewLanState().ownerPresent, 'a gap to show presence')

		await refuse()
		fake.event('status.event.entityStatusChanged', {
			entityId: 'ent-bob',
			statusId: 'offline',
			chosenStatusId: 'ready',
			previousStatusId: 'ready',
			cause: 'presence',
			since: new Date().toISOString(),
			changedAt: new Date().toISOString(),
		})
		await waitFor(() => host.instance.getCrewLanState().ownerPresent, "another participant's Offline to show presence")
		fake.controls = {
			...fake.controls,
			audio: { connected: true, sending: false },
			changedAt: new Date().toISOString(),
		}
	})

	it('lights a macro on its run and dims it when the run ends', async () => {
		fake.event('macros.event.macroRunStarted', { macroId: 'mac-1', runId: 'run-1' })
		await waitFor(() => host.instance.isMacroRunning('mac-1'), 'the macro to run')
		fake.event('macros.event.macroRunEnded', { macroId: 'mac-1', runId: 'run-1', outcome: 'completed' })
		await waitFor(() => !host.instance.isMacroRunning('mac-1'), 'the macro to end')
	})

	it('reads the controls again on controlsChanged, ringing included', async () => {
		fake.controls = { ...fake.controls, ringing: [], call: { callerId: 'ent-bob' } }
		fake.event('intercom.event.controlsChanged', { entityId: 'ent-1', cause: 'ringing' })
		await waitFor(() => host.instance.getCrewLanState().intercom?.call?.name === 'Bob', 'the call to be up')
		assert.equal(host.instance.getCrewLanState().controls?.shoutbox.talk.available, false)
	})

	it('answers nothing while a call is up, even while somebody rings', async () => {
		fake.controls = { ...fake.controls, ringing: [{ callerId: 'ent-bob' }], call: { callerId: 'ent-bob' } }
		fake.event('intercom.event.controlsChanged', { entityId: 'ent-1', cause: 'ringing' })
		await waitFor(() => host.instance.getCrewLanState().intercom?.ringing.length === 1, 'somebody to ring')
		const before = bodies('intercom.command.setControls').length

		await host.instance.answerCall()

		assert.equal(bodies('intercom.command.setControls').length, before)
		assert.ok(host.logs.includes('warn: Answer: you are already in a call; hang it up first.'))
	})

	it('drops a group the participant left and registers the presets again', async () => {
		const registrations = host.registrations
		fake.groups = fake.groups.slice(0, 1)
		fake.event('intercom.event.memberRemoved', { groupId: 'grp-stage', entityId: 'ent-1', cause: 'left' })
		await waitFor(() => host.instance.getCrewLanState().intercom?.groups.length === 1, 'the group to drop out')
		assert.ok(host.registrations > registrations)
		assert.ok(!host.presets.includes('group_grp-stage_talk_push'))
	})

	it('reads the Workspace again on a gap', async () => {
		const snapshots = fake.requests.filter((request) => request.path === '/api/v2/snapshot').length
		fake.send('event: gap\ndata: {}\n\n')
		await waitFor(
			() => fake.requests.filter((request) => request.path === '/api/v2/snapshot').length > snapshots,
			'the snapshot to be read again',
		)
	})

	it('reports a paused connection when the stream ends with that code', async () => {
		// A controls read in flight at the end re-arms nothing: the controls stay cleared while down.
		fake.slowControls = true
		await waitFor(() => fake.controlsInFlight > 0, 'a controls read in flight')
		fake.send('event: ended\ndata: {"code":"connection_paused"}\n\n')
		await waitFor(() => host.status === 'authentication_failure', 'the authentication failure')
		const reads = () => fake.requests.filter((request) => request.path.endsWith('intercom.query.getControls')).length
		const before = reads()
		await sleep(2500)
		assert.ok(reads() - before <= 1, `controls read ${String(reads() - before)} times while down`)
		assert.equal(host.instance.getCrewLanState().controls, null)
	})
})

describe('module against a Public API v1 switched off', () => {
	const sentence =
		'the v1 compatibility mode is off in this Workspace: an administrator switches it on in Administration, under Connections'
	let server: http.Server
	let host: Host

	before(async () => {
		server = http.createServer((request, response) => {
			const v1 = (request.url ?? '').startsWith('/api/v1')
			response.writeHead(v1 ? 403 : 404, { 'content-type': 'application/json' })
			response.end(
				JSON.stringify(
					v1
						? { error: 'forbidden', message: sentence, statusCode: 403 }
						: { error: 'not_found', message: 'not served' },
				),
			)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		host = createHost()
		await host.instance.init(
			{ baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, pollIntervalMs: 1000 },
			true,
			{ entityToken: 'cle_test' },
		)
	})

	after(async () => {
		await host.instance.destroy()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	})

	it("shows an authentication failure with the Core's sentence and asks again after 60 s", async () => {
		await waitFor(() => host.status === 'authentication_failure', 'the authentication failure')
		assert.ok(host.logs.some((line) => line.startsWith('status:authentication_failure') && line.endsWith(sentence)))
		assert.ok(host.logs.some((line) => line === 'debug: Reconnecting to CrewLAN in 60000 ms.'))
	})
})
