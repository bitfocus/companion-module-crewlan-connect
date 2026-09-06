import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import ModuleInstance from '../src/main.js'
import type { PublicEntityControlsDto, PublicEntityStatusDto, PublicMacroDto, PublicStatusDto } from '../src/types.js'

/**
 * End-to-end checks against a stub of the CrewLAN Public API: the module is driven through a fake
 * Companion host, so registration, the live event stream, the write paths and the teardown are
 * exercised the way Companion exercises them.
 */

const meta = { apiVersion: 'v1', revision: 1 }

function makeStatus(id: string, label: string): PublicStatusDto {
	return {
		id,
		kind: 'system',
		label,
		paletteKey: 'green',
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		alertType: null,
		motionPreset: 'none',
		selectable: true,
	}
}

function laterIso(offsetMs: number): string {
	return new Date(Date.now() + offsetMs).toISOString()
}

function makeMacro(id: string, label: string, overrides: Partial<PublicMacroDto> = {}): PublicMacroDto {
	return {
		id,
		label,
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		running: false,
		runnable: true,
		sortOrder: 0,
		runStartedAt: null,
		updatedAt: laterIso(0),
		...overrides,
	}
}

interface Stub {
	port: number
	calls: string[]
	macros: PublicMacroDto[]
	macrosSupported: boolean
	/** When true the stub drops every connection, standing in for a host that went away. */
	offline: boolean
	controls: PublicEntityControlsDto
	status: PublicEntityStatusDto
	stream: http.ServerResponse | null
	close(): Promise<void>
}

async function startCrewLanStub(): Promise<Stub> {
	const stub: Stub = {
		port: 0,
		calls: [],
		controls: {
			entityId: 'alex',
			shoutbox: {
				listen: { enabled: true, muted: false, available: true },
				talk: {
					enabled: true,
					active: false,
					live: false,
					controlMode: null,
					latchedPreference: false,
					available: true,
				},
			},
			updatedAt: laterIso(0),
		},
		status: {
			entityId: 'alex',
			status: makeStatus('sys-green', 'OK'),
			selectedStatusId: 'sys-green',
			updatedAt: laterIso(0),
		},
		macros: [makeMacro('macro-showstart', 'Show Start'), makeMacro('macro-hidden', 'Hidden', { runnable: false })],
		macrosSupported: true,
		offline: false,
		stream: null,
		close: async () => undefined,
	}

	const server = http.createServer((request, response) => {
		const path = (request.url ?? '').split('?')[0] ?? ''

		if (stub.offline) {
			request.socket.destroy()
			return
		}

		stub.calls.push(`${request.method ?? 'GET'} ${path}`)
		let body = ''
		request.on('data', (chunk) => (body += String(chunk)))
		request.on('end', () => {
			const json = (data: unknown): void => {
				response.writeHead(200, { 'content-type': 'application/json' })
				response.end(JSON.stringify({ data, meta }))
			}

			if (path === '/api/v1/events') {
				response.writeHead(200, { 'content-type': 'text/event-stream' })
				response.write('retry: 1000\n\n: heartbeat\n\n')
				stub.stream = response
				return
			}

			if (path === '/api/v1/session') {
				json({ workspace: { required: false, granted: true }, entities: [{ entityId: 'alex', granted: true }] })
				return
			}

			if (path === '/api/v1/workspace') {
				json({ id: 'ws', name: 'Show', listenMode: 'lan', protected: false, features: [] })
				return
			}

			if (path === '/api/v1/entities/alex') {
				json({
					id: 'alex',
					type: 'participant',
					displayName: 'Alex',
					position: 'FOH',
					credentialRequired: false,
					lastSeenAt: laterIso(0),
					status: makeStatus('sys-green', 'OK'),
				})
				return
			}

			if (path === '/api/v1/statuses') {
				json([makeStatus('sys-green', 'OK'), makeStatus('sys-red', 'Emergency')])
				return
			}

			if (path === '/api/v1/entities/alex/status') {
				if (request.method === 'PUT') {
					const statusId = String((JSON.parse(body) as { statusId: string }).statusId)
					stub.status = {
						entityId: 'alex',
						status: makeStatus(statusId, statusId),
						selectedStatusId: statusId,
						updatedAt: laterIso(1000),
					}
					json({ status: 'updated', entityId: 'alex', selectedStatusId: statusId, revision: 2 })
					return
				}

				json(stub.status)
				return
			}

			if (path === '/api/v1/entities/alex/controls') {
				if (request.method === 'PATCH') {
					const patch = (JSON.parse(body) as { shoutbox: Record<string, Record<string, unknown>> }).shoutbox

					if (patch.listen?.muted !== undefined) {
						stub.controls.shoutbox.listen.muted = patch.listen.muted === true
					}

					if (patch.talk?.active !== undefined) {
						const active = patch.talk.active === true
						stub.controls.shoutbox.talk.active = active
						stub.controls.shoutbox.talk.live = active
						stub.controls.shoutbox.talk.controlMode = (patch.talk.controlMode as 'push' | 'latch' | null) ?? null
					}

					stub.controls.updatedAt = laterIso(2000)
				}

				json(stub.controls)
				return
			}

			if (path === '/api/v1/macros') {
				if (!stub.macrosSupported) {
					response.writeHead(404, { 'content-type': 'application/json' })
					response.end(JSON.stringify({ error: 'not_found', message: 'No macro support.' }))
					return
				}

				json(stub.macros)
				return
			}

			if (path.startsWith('/api/v1/macros/') && path.endsWith('/run')) {
				const macroId = decodeURIComponent(path.slice('/api/v1/macros/'.length, -'/run'.length))
				const index = stub.macros.findIndex((macro) => macro.id === macroId)
				const current = stub.macros[index]

				if (current === undefined) {
					response.writeHead(404, { 'content-type': 'application/json' })
					response.end(JSON.stringify({ error: 'not_found', message: 'No such macro.' }))
					return
				}

				const started = { ...current, running: true, runStartedAt: laterIso(0), updatedAt: laterIso(3000) }
				stub.macros = stub.macros.with(index, started)
				json(started)
				return
			}

			if (path === '/api/v1/entities/alex/alerts/dismiss') {
				json({ status: 'updated', entityId: 'alex', dismissedCount: 1 })
				return
			}

			response.writeHead(404, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ error: 'not_found', message: 'No such CrewLAN resource.' }))
		})
	})

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	stub.port = (server.address() as AddressInfo).port
	stub.close = async () => {
		stub.stream?.end()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}

	return stub
}

interface Host {
	instance: ModuleInstance
	variables: Record<string, unknown>
	registered: { actions: string[]; feedbacks: string[]; variables: string[]; presets: string[] }
	checked: string[][]
	registrations: number
	status: string | null
	logs: string[]
	actions: Record<string, { callback: (event: { options: Record<string, unknown> }) => unknown }>
}

function createHost(): Host {
	const host: Host = {
		instance: null as unknown as ModuleInstance,
		variables: {},
		registered: { actions: [], feedbacks: [], variables: [], presets: [] },
		checked: [],
		registrations: 0,
		status: null,
		logs: [],
		actions: {},
	}

	const context = {
		id: 'test',
		label: 'test',
		_isInstanceContext: true,
		saveConfig: () => undefined,
		setActionDefinitions: (definitions: Record<string, unknown>) => {
			host.registered.actions = Object.keys(definitions)
			host.actions = definitions as Host['actions']
		},
		setFeedbackDefinitions: (definitions: Record<string, unknown>) => {
			host.registered.feedbacks = Object.keys(definitions)
		},
		setPresetDefinitions: (_structure: unknown, presets: Record<string, unknown>) => {
			host.registered.presets = Object.keys(presets)
			host.registrations += 1
		},
		setVariableDefinitions: (definitions: Record<string, unknown>) => {
			host.registered.variables = Object.keys(definitions)
		},
		setVariableValues: (values: Record<string, unknown>) => Object.assign(host.variables, values),
		getVariableValue: (key: string) => host.variables[key],
		checkAllFeedbacks: () => host.checked.push(['ALL']),
		checkFeedbacks: (ids: string[]) => host.checked.push(ids),
		checkFeedbacksById: () => undefined,
		subscribeActions: () => undefined,
		unsubscribeActions: () => undefined,
		unsubscribeFeedbacks: () => undefined,
		recordAction: () => undefined,
		oscSend: () => undefined,
		updateStatus: (status: string, message?: string | null) => {
			host.status = status
			host.logs.push(`status:${status}${message === null || message === undefined ? '' : ` ${message}`}`)
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

/** Poll a condition instead of sleeping, so a loaded CI runner cannot turn timing into failure. */
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

describe('module against a CrewLAN stub', () => {
	let stub: Stub
	let host: Host

	before(async () => {
		stub = await startCrewLanStub()
		host = createHost()
		await host.instance.init({ baseUrl: `http://127.0.0.1:${String(stub.port)}`, pollIntervalMs: 1000 }, true, {
			entityToken: 'cle_test',
		})
		await waitFor(() => host.status === 'ok', 'the connection to report ok')
		await waitFor(() => host.variables.event_stream_connected === true, 'the event stream to connect')
	})

	after(async () => {
		await host.instance.destroy()
		await stub.close()
	})

	it('registers its full Companion surface', () => {
		assert.equal(host.registered.actions.length, 8)
		assert.equal(host.registered.feedbacks.length, 14)
		assert.equal(host.registered.variables.length, 20)
		// Four fixed presets, one per selectable status, one per runnable macro.
		assert.equal(host.registered.presets.length, 7)
		assert.ok(host.registered.presets.includes('macro_macro-showstart'))
		assert.ok(!host.registered.presets.includes('macro_macro-hidden'), 'a macro that is not runnable gets no button')
	})

	it('connects and publishes state, with booleans as real booleans', () => {
		assert.equal(host.status, 'ok')
		assert.equal(host.variables.workspace_name, 'Show')
		assert.equal(host.variables.entity_name, 'Alex')
		assert.equal(host.variables.event_stream_connected, true)
		assert.equal(host.variables.talk_live, false)
		assert.equal(typeof host.variables.talk_live, 'boolean')
		assert.equal(host.variables.macros_supported, true)
		assert.equal(host.variables.running_macro_count, 0)
		assert.equal(host.variables.running_macro_labels, '')
	})

	it('opens and closes the talk channel well inside the action budget', async () => {
		assert.ok(host.actions.talk_push_down, 'actions are registered')

		await host.actions.talk_push_down?.callback({ options: {} })
		assert.equal(stub.controls.shoutbox.talk.active, true)
		assert.equal(host.variables.talk_active, true)

		const startedAt = Date.now()
		await host.actions.talk_push_up?.callback({ options: {} })
		assert.equal(stub.controls.shoutbox.talk.active, false)
		assert.ok(Date.now() - startedAt < 5000, 'talk release must finish inside Companion’s 5 s action budget')
	})

	it('runs the remaining write actions', async () => {
		await host.actions.set_status?.callback({ options: { statusId: 'sys-red' } })
		assert.equal(host.variables.current_status_id, 'sys-red')

		await host.actions.listen_mute?.callback({ options: { mode: 'toggle' } })
		assert.equal(stub.controls.shoutbox.listen.muted, true)
		assert.equal(host.variables.listen_muted, true)

		await host.actions.dismiss_alerts?.callback({ options: {} })
		assert.equal(host.variables.last_alert, '')
	})

	it('applies live events and rechecks only the affected feedbacks', async () => {
		host.checked.length = 0
		const controls = {
			...stub.controls,
			updatedAt: laterIso(9000),
			shoutbox: {
				...stub.controls.shoutbox,
				talk: { ...stub.controls.shoutbox.talk, active: true, live: true, controlMode: 'latch' },
			},
		}
		stub.stream?.write(
			`id: 9\nevent: entity.controls.changed\ndata: ${JSON.stringify({
				id: '9',
				type: 'entity.controls.changed',
				occurredAt: laterIso(9000),
				meta,
				data: controls,
			})}\n\n`,
		)
		await waitFor(() => host.variables.talk_live === true, 'the controls event to be applied')

		const lastCheck = host.checked.at(-1) ?? []
		assert.ok(lastCheck.includes('talk_live'), 'controls feedbacks are rechecked')
		assert.ok(!lastCheck.includes('connection_ok'), 'unrelated feedbacks are not rechecked')
		assert.ok(!lastCheck.includes('status_is'), 'unrelated feedbacks are not rechecked')
	})

	it('records an alert and survives a malformed frame split across chunks', async () => {
		stub.stream?.write(
			`id: 10\nevent: alert.triggered\ndata: ${JSON.stringify({
				id: '10',
				type: 'alert.triggered',
				occurredAt: '2026-08-03T19:00:00.000Z',
				meta,
				data: { scope: 'workspace', targetEntityIds: null },
			})}\n\n`,
		)
		await waitFor(() => host.variables.last_alert !== '', 'the alert event to be applied')
		assert.equal(host.variables.last_alert, 'Workspace alert at 2026-08-03T19:00:00.000Z')

		const frame = `id: 11\nevent: status.changed\ndata: ${JSON.stringify({
			id: '11',
			type: 'status.changed',
			occurredAt: laterIso(20000),
			meta,
			data: {
				entityId: 'alex',
				status: makeStatus('sys-green', 'OK'),
				selectedStatusId: 'sys-green',
				updatedAt: laterIso(20000),
			},
		})}\n\n`
		stub.stream?.write('data: {broken\n\n')
		stub.stream?.write(frame.slice(0, 30))
		await sleep(60)
		stub.stream?.write(frame.slice(30))
		await waitFor(() => host.variables.current_status_id === 'sys-green', 'the split frame to be applied')
	})

	it('starts a macro and lights its button without re-registering the definitions', async () => {
		host.checked.length = 0
		const registrationsBefore = host.registrations

		await host.actions.run_macro?.callback({ options: { macroId: 'macro-showstart' } })

		assert.equal(stub.macros[0]?.running, true)
		assert.equal(host.variables.running_macro_count, 1)
		assert.equal(host.variables.running_macro_labels, 'Show Start')

		const lastCheck = host.checked.at(-1) ?? []
		assert.deepEqual(lastCheck, ['macro_running', 'macro_style'], 'only the macro feedbacks are rechecked')
		assert.equal(host.registrations, registrationsBefore, 'a running macro must not re-register the definitions')
	})

	it('refuses to start a macro CrewLAN does not know', async () => {
		const callsBefore = stub.calls.length

		await host.actions.run_macro?.callback({ options: { macroId: 'macro-nope' } })

		assert.equal(stub.calls.length, callsBefore, 'no request is sent for an unknown macro')
		assert.ok(host.logs.some((line) => /has no macro with id "macro-nope"/u.test(line)))
	})

	it('adds, updates and removes macros from live events', async () => {
		const registrationsBefore = host.registrations
		const added = makeMacro('macro-blackout', 'Blackout', { updatedAt: laterIso(10000) })
		stub.stream?.write(
			`id: 20\nevent: macro.changed\ndata: ${JSON.stringify({
				id: '20',
				type: 'macro.changed',
				occurredAt: laterIso(10000),
				meta,
				data: added,
			})}\n\n`,
		)
		await waitFor(() => host.registered.presets.includes('macro_macro-blackout'), 'the new macro to get a button')
		assert.ok(host.registrations > registrationsBefore, 'a new macro re-registers the definitions')

		stub.stream?.write(
			`id: 21\nevent: macro.removed\ndata: ${JSON.stringify({
				id: '21',
				type: 'macro.removed',
				occurredAt: laterIso(11000),
				meta,
				data: { id: 'macro-blackout' },
			})}\n\n`,
		)
		await waitFor(() => !host.registered.presets.includes('macro_macro-blackout'), 'the removed macro to disappear')
	})

	it('ignores a macro update that is older than the state it would overwrite', async () => {
		const stale = makeMacro('macro-showstart', 'Show Start', { running: false, updatedAt: '2020-01-01T00:00:00.000Z' })
		stub.stream?.write(
			`id: 22\nevent: macro.changed\ndata: ${JSON.stringify({
				id: '22',
				type: 'macro.changed',
				occurredAt: laterIso(12000),
				meta,
				data: stale,
			})}\n\n`,
		)
		await sleep(200)

		assert.equal(host.variables.running_macro_count, 1, 'the running macro survives a stale update')
	})

	it('notices a stream the server closed and keeps working', async () => {
		const callsBefore = stub.calls.length
		stub.stream?.end()
		stub.stream = null

		await waitFor(() => stub.calls.length > callsBefore, 'polling to continue after the stream closed')
		await waitFor(() => host.logs.some((line) => /event stream/iu.test(line)), 'the lost stream to be reported')
	})

	it('stops claiming a macro runs once the connection is gone', async () => {
		const presetsBefore = host.registered.presets.length
		stub.offline = true

		await waitFor(() => host.status !== 'ok', 'the connection to be reported as broken')
		await waitFor(() => host.variables.running_macro_count === 0, 'the running flag to be cleared')
		assert.equal(host.registered.presets.length, presetsBefore, 'the macro buttons survive the disconnect')
	})

	it('makes no further requests after destroy', async () => {
		await host.instance.destroy()
		const callsAtDestroy = stub.calls.length
		// More than one poll interval: a leaked timer would have fired by now.
		await sleep(2500)

		assert.equal(stub.calls.length, callsAtDestroy)
	})
})

describe('module against a CrewLAN without macro support', () => {
	let stub: Stub
	let host: Host

	before(async () => {
		stub = await startCrewLanStub()
		stub.macrosSupported = false
		host = createHost()
		await host.instance.init({ baseUrl: `http://127.0.0.1:${String(stub.port)}`, pollIntervalMs: 1000 }, true, {
			entityToken: 'cle_test',
		})
		await waitFor(() => host.status === 'ok', 'the connection to report ok')
	})

	after(async () => {
		await host.instance.destroy()
		await stub.close()
	})

	it('connects anyway and simply offers no macro buttons', () => {
		assert.equal(host.status, 'ok')
		assert.equal(host.variables.macros_supported, false)
		assert.equal(
			host.registered.presets.some((id) => id.startsWith('macro_')),
			false,
		)
	})
})
