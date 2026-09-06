import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	CrewLanApiClient,
	CrewLanApiError,
	ServerSentEventParser,
	normalizeBaseUrl,
	parseServerSentEvents,
	type CrewLanApiLogger,
} from '../src/api.js'

type FetchMock = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function streamResponse(chunks: string[]): Response {
	const encoder = new TextEncoder()

	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) {
					controller.enqueue(encoder.encode(chunk))
				}

				controller.close()
			},
		}),
		{ status: 200, headers: { 'content-type': 'text/event-stream' } },
	)
}

function silentStreamResponse(): Response {
	return new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 })
}

async function withFetch<T>(mock: FetchMock, run: () => Promise<T>): Promise<T> {
	const originalFetch = globalThis.fetch
	globalThis.fetch = mock

	try {
		return await run()
	} finally {
		globalThis.fetch = originalFetch
	}
}

/**
 * A fetch that only settles once the request is aborted.
 *
 * The guard timer is deliberately ref'd: `AbortSignal.timeout()` does not keep the event loop
 * alive, so without it Node would drain the loop while this promise is still pending and cancel
 * the test run.
 */
async function fetchThatOnlyAborts(init?: RequestInit): Promise<Response> {
	return new Promise<Response>((_resolve, reject) => {
		const guard = setTimeout(() => reject(new Error('the fetch mock was never aborted')), 10000)
		init?.signal?.addEventListener('abort', () => {
			clearTimeout(guard)
			reject(new DOMException('aborted', 'AbortError'))
		})
	})
}

function requestUrl(input: string | URL | Request): string {
	return input instanceof Request ? input.url : String(input)
}

function createClient(
	logger?: CrewLanApiLogger,
	timeoutMs?: number,
	streamConnectTimeoutMs?: number,
): CrewLanApiClient {
	return new CrewLanApiClient({
		baseUrl: 'http://127.0.0.1:4848',
		token: 'cle_test-token',
		...(timeoutMs === undefined ? {} : { timeoutMs }),
		...(streamConnectTimeoutMs === undefined ? {} : { streamConnectTimeoutMs }),
		...(logger === undefined ? {} : { logger }),
	})
}

interface RecordingLogger extends CrewLanApiLogger {
	debugMessages: string[]
	warnMessages: string[]
}

function createLogger(): RecordingLogger {
	const debugMessages: string[] = []
	const warnMessages: string[] = []

	return {
		debugMessages,
		warnMessages,
		debug: (message) => {
			debugMessages.push(message)
		},
		warn: (message) => {
			warnMessages.push(message)
		},
	}
}

const meta = { apiVersion: 'v1', revision: 14 }

const entityStatus = {
	entityId: 'participant-alex',
	status: {
		id: 'sys-green',
		kind: 'system',
		label: 'OK',
		paletteKey: 'green',
		colors: { backgroundColor: '#0f8f4f', foregroundColor: '#ffffff' },
		alertType: null,
		motionPreset: 'none',
		selectable: true,
	},
	selectedStatusId: 'sys-green',
	updatedAt: '2026-08-03T18:44:41.000Z',
}

function eventFrame(type: string, data: unknown, id = '1'): string {
	return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ id, type, occurredAt: '2026-08-03T18:44:41.000Z', data, meta })}\n\n`
}

describe('CrewLAN API client helpers', () => {
	it('normalizes base URLs', () => {
		assert.equal(normalizeBaseUrl('http://127.0.0.1:4848///'), 'http://127.0.0.1:4848')
		assert.equal(normalizeBaseUrl('http://crewlan.local:4848/api///?debug=1#hash'), 'http://crewlan.local:4848')
		assert.equal(normalizeBaseUrl('http://crewlan.local:4848/api/v1'), 'http://crewlan.local:4848')
	})

	it('drops credentials embedded in the address', () => {
		assert.equal(normalizeBaseUrl('http://user:secret@crewlan.local:4848'), 'http://crewlan.local:4848')
	})

	it('keeps a reverse-proxy sub-path but drops a trailing API path', () => {
		assert.equal(normalizeBaseUrl('http://host:4848/crewlan'), 'http://host:4848/crewlan')
		assert.equal(normalizeBaseUrl('http://host:4848/crewlan/api/v1/'), 'http://host:4848/crewlan')
		assert.equal(normalizeBaseUrl('http://host:4848/crewlan/api'), 'http://host:4848/crewlan')
	})

	it('rejects invalid base URLs with useful errors', () => {
		assert.throws(() => normalizeBaseUrl('not a url'), CrewLanApiError)
		assert.throws(() => normalizeBaseUrl('ftp://crewlan.local'), /http:\/\/ or https:\/\//u)
	})

	it('reports an unusable address or a missing token as a configuration error', () => {
		// The kind matters: it is what keeps the module from retrying something only the operator can fix.
		for (const address of ['', 'not a url', 'ftp://crewlan.local']) {
			assert.throws(
				() => normalizeBaseUrl(address),
				(error: unknown) => error instanceof CrewLanApiError && error.kind === 'config',
				`address ${JSON.stringify(address)}`,
			)
		}

		assert.throws(
			() => new CrewLanApiClient({ baseUrl: 'http://127.0.0.1:4848', token: '   ' }),
			(error: unknown) =>
				error instanceof CrewLanApiError &&
				error.kind === 'config' &&
				/Connection token is required/u.test(error.message),
		)
	})

	it('parses complete server-sent events and ignores comments', () => {
		const events = parseServerSentEvents(
			[
				'retry: 1000',
				'',
				': heartbeat 1754246681000',
				'',
				...eventFrame('status.changed', entityStatus).split('\n'),
			].join('\n'),
		)

		assert.equal(events.length, 1)
		assert.equal(events[0]?.type, 'status.changed')
	})

	it('parses multiline CRLF server-sent event data', () => {
		const events = parseServerSentEvents(
			[
				'id: 2',
				'event: status.changed',
				'data: {"id":"2","type":"status.changed","occurredAt":"2026-08-03T18:44:41.000Z",',
				'data: "data":{"entityId":"alex"},"meta":{"apiVersion":"v1","revision":2}}',
				'',
			].join('\r\n'),
		)

		assert.equal(events.length, 1)
		assert.equal(events[0]?.type, 'status.changed')
		assert.deepEqual(events[0]?.data, { entityId: 'alex' })
	})

	it('skips malformed frames and reports them to the logger', () => {
		const logger = createLogger()
		const events = parseServerSentEvents('data: {not json\n\ndata: {"type":"x"}\n\n', logger)

		assert.equal(events.length, 0)
		assert.equal(logger.debugMessages.length, 2)
	})
})

describe('ServerSentEventParser', () => {
	it('keeps a CRLF split across chunks as one line break', () => {
		const parser = new ServerSentEventParser()
		const first = parser.push('data: {"a":1}\r')
		const second = parser.push('\ndata: {"b":2}\r\n\r\n')

		assert.deepEqual(first, [])
		assert.deepEqual(second, ['{"a":1}\n{"b":2}'])
	})

	it('accepts lone carriage returns as line terminators', () => {
		const parser = new ServerSentEventParser()

		assert.deepEqual(parser.push('data: one\r\rdata: two\r\r'), ['one'])
		// The trailing \r is held back until it is clear it is not the first half of \r\n.
		assert.deepEqual(parser.flush(), ['two'])
	})

	it('holds partial events until they complete', () => {
		const parser = new ServerSentEventParser()

		assert.deepEqual(parser.push('data: {"a"'), [])
		assert.deepEqual(parser.push(':1}\n'), [])
		assert.deepEqual(parser.push('\n'), ['{"a":1}'])
	})

	it('flushes a trailing event without a final blank line', () => {
		const parser = new ServerSentEventParser()

		assert.deepEqual(parser.push('data: tail'), [])
		assert.deepEqual(parser.flush(), ['tail'])
	})

	it('gives up when the buffer grows without an event boundary', () => {
		const parser = new ServerSentEventParser(16)

		assert.throws(() => parser.push('x'.repeat(17)), /more than 1 MB/u)
	})

	it('gives up on a frame whose blank line never arrives, however many data lines it has', () => {
		const parser = new ServerSentEventParser(32)

		// Every line is terminated, so the buffer itself always drains; only the undelivered frame
		// grows. A server that never writes the blank line must not be able to exhaust memory.
		assert.throws(() => {
			for (let attempt = 0; attempt < 10; attempt++) {
				parser.push('data: 0123456789\n')
			}
		}, /more than 1 MB/u)
	})

	it('forgets the frame it dispatched, so a long stream of small events never trips the limit', () => {
		const parser = new ServerSentEventParser(32)

		for (let attempt = 0; attempt < 50; attempt++) {
			assert.deepEqual(parser.push('data: 0123456789\n\n'), ['0123456789'])
		}
	})
})

describe('CrewLAN API client requests', () => {
	it('dismisses entity alerts through the Public API', async () => {
		let requestedUrl = ''
		let requestedMethod = ''
		let requestedAuthorization = ''

		const result = await withFetch(
			async (input, init) => {
				requestedUrl = requestUrl(input)
				requestedMethod = String(init?.method ?? 'GET')
				requestedAuthorization = String(new Headers(init?.headers).get('authorization') ?? '')

				return jsonResponse({ data: { status: 'updated', entityId: 'participant-alex', dismissedCount: 2 }, meta })
			},
			async () => createClient().dismissEntityAlerts('participant-alex'),
		)

		assert.equal(requestedUrl, 'http://127.0.0.1:4848/api/v1/entities/participant-alex/alerts/dismiss')
		assert.equal(requestedMethod, 'POST')
		assert.equal(requestedAuthorization, 'Bearer cle_test-token')
		assert.equal(result.status, 'updated')
		assert.equal(result.dismissedCount, 2)
	})

	it('times out requests that never answer', async () => {
		await withFetch(
			async (_input, init) => fetchThatOnlyAborts(init),
			async () => {
				await assert.rejects(
					createClient(undefined, 200).getSession(),
					(error: unknown) =>
						error instanceof CrewLanApiError && error.kind === 'timeout' && /200 ms/u.test(error.message),
				)
			},
		)
	})

	it('reports caller cancellation separately from timeouts', async () => {
		const controller = new AbortController()

		await withFetch(
			async (_input, init) => fetchThatOnlyAborts(init),
			async () => {
				const pending = createClient().getSession({ signal: controller.signal })
				controller.abort()
				await assert.rejects(pending, (error: unknown) => error instanceof CrewLanApiError && error.kind === 'aborted')
			},
		)
	})

	it('turns a non-JSON 200 into an actionable error', async () => {
		await withFetch(
			async () => new Response('<html>captive portal</html>', { status: 200 }),
			async () => {
				await assert.rejects(
					createClient().getSession(),
					(error: unknown) =>
						error instanceof CrewLanApiError &&
						error.kind === 'invalid-response' &&
						/check the address/u.test(error.message),
				)
			},
		)
	})

	it('rejects payloads that do not match the expected shape', async () => {
		const logger = createLogger()

		await withFetch(
			async () => jsonResponse({ data: { shoutbox: {} }, meta }),
			async () => {
				await assert.rejects(
					createClient(logger).getEntityControls('participant-alex'),
					(error: unknown) => error instanceof CrewLanApiError && error.kind === 'invalid-response',
				)
			},
		)

		assert.equal(logger.debugMessages.length, 1)
	})

	it('uses the server message for HTTP errors', async () => {
		await withFetch(
			async () =>
				jsonResponse({ error: 'entity_access_required', message: 'Entity access is required.', statusCode: 401 }, 401),
			async () => {
				await assert.rejects(
					createClient().getSession(),
					(error: unknown) =>
						error instanceof CrewLanApiError &&
						error.kind === 'http' &&
						error.statusCode === 401 &&
						error.message === 'Entity access is required.',
				)
			},
		)
	})

	it('describes unreachable hosts as network errors', async () => {
		await withFetch(
			async () => {
				throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:4848') })
			},
			async () => {
				await assert.rejects(
					createClient().getSession(),
					(error: unknown) =>
						error instanceof CrewLanApiError && error.kind === 'network' && /ECONNREFUSED/u.test(error.message),
				)
			},
		)
	})

	it('re-reads the status after a successful PUT', async () => {
		const methods: string[] = []

		const result = await withFetch(
			async (input, init) => {
				methods.push(`${String(init?.method ?? 'GET')} ${requestUrl(input)}`)

				if (init?.method === 'PUT') {
					return jsonResponse({
						data: { status: 'updated', entityId: 'participant-alex', selectedStatusId: 'sys-green', revision: 15 },
						meta,
					})
				}

				return jsonResponse({ data: entityStatus, meta })
			},
			async () => createClient().setEntityStatus('participant-alex', 'ok'),
		)

		assert.deepEqual(methods, [
			'PUT http://127.0.0.1:4848/api/v1/entities/participant-alex/status',
			'GET http://127.0.0.1:4848/api/v1/entities/participant-alex/status',
		])
		assert.equal(result.selectedStatusId, 'sys-green')
		assert.equal(result.status?.status.id, 'sys-green')
	})

	it('keeps a successful PUT even when the re-read fails', async () => {
		const logger = createLogger()

		const result = await withFetch(
			async (_input, init) => {
				if (init?.method === 'PUT') {
					return jsonResponse({
						data: { status: 'updated', entityId: 'participant-alex', selectedStatusId: 'sys-green', revision: 15 },
						meta,
					})
				}

				return jsonResponse({ error: 'internal_error', message: 'Internal server error', statusCode: 500 }, 500)
			},
			async () => createClient(logger).setEntityStatus('participant-alex', 'ok'),
		)

		assert.equal(result.selectedStatusId, 'sys-green')
		assert.equal(result.status, null)
		assert.equal(logger.debugMessages.length, 1)
	})
})

describe('CrewLAN API client event stream', () => {
	it('delivers events split across chunk boundaries and resolves when the server closes', async () => {
		const frame = eventFrame('status.changed', entityStatus).replace(/\n/gu, '\r\n')
		const cut = frame.indexOf('\r\n\r\n') + 1
		const received: string[] = []
		let opened = 0

		await withFetch(
			async () => streamResponse([': connected\r\n\r\n', frame.slice(0, cut), frame.slice(cut)]),
			async () =>
				createClient().streamEvents({
					signal: new AbortController().signal,
					onOpen: () => {
						opened++
					},
					onEvent: (event) => received.push(event.type),
				}),
		)

		assert.equal(opened, 1)
		assert.deepEqual(received, ['status.changed'])
	})

	it('survives a handler that throws and keeps reading', async () => {
		const logger = createLogger()
		// The envelope id is optional (no guard checks it), so a frame that lost its id shows up as
		// undefined here and fails the assertion below rather than being silently coerced away.
		const received: (string | undefined)[] = []

		await withFetch(
			async () =>
				streamResponse([eventFrame('status.changed', entityStatus, '1'), eventFrame('alert.triggered', {}, '2')]),
			async () =>
				createClient(logger).streamEvents({
					signal: new AbortController().signal,
					onEvent: (event) => {
						received.push(event.id)

						if (event.id === '1') {
							throw new Error('boom')
						}
					},
				}),
		)

		assert.deepEqual(received, ['1', '2'])
		assert.equal(logger.warnMessages.length, 1)
	})

	it('aborts a stream that goes silent for longer than the idle timeout', async () => {
		await withFetch(
			async () => silentStreamResponse(),
			async () => {
				await assert.rejects(
					createClient().streamEvents({
						signal: new AbortController().signal,
						idleTimeoutMs: 200,
						onEvent: () => undefined,
					}),
					(error: unknown) => error instanceof CrewLanApiError && error.kind === 'timeout',
				)
			},
		)
	})

	it('resolves quietly when the caller aborts', async () => {
		const controller = new AbortController()

		await withFetch(
			async (_input, init) => {
				init?.signal?.addEventListener('abort', () => undefined)
				return silentStreamResponse()
			},
			async () => {
				const pending = createClient().streamEvents({
					signal: controller.signal,
					onEvent: () => undefined,
				})
				setTimeout(() => controller.abort(), 10)
				await pending
			},
		)
	})

	it('reports a rejected stream with the HTTP status', async () => {
		await withFetch(
			async () => jsonResponse({ error: 'workspace_access_required', message: 'Workspace access is required.' }, 401),
			async () => {
				await assert.rejects(
					createClient().streamEvents({ signal: new AbortController().signal, onEvent: () => undefined }),
					(error: unknown) => error instanceof CrewLanApiError && error.statusCode === 401,
				)
			},
		)
	})
})

describe('CrewLAN API client event stream handshake', () => {
	it('does not cut a healthy stream after the handshake deadline', async () => {
		const received: string[] = []
		const controller = new AbortController()
		const encoder = new TextEncoder()

		// The body arrives well after the handshake deadline: it may only govern the handshake.
		await withFetch(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(streamController) {
							setTimeout(() => {
								streamController.enqueue(encoder.encode(eventFrame('status.changed', entityStatus)))
								streamController.close()
							}, 600)
						},
					}),
					{ status: 200 },
				),
			async () =>
				createClient(undefined, undefined, 200).streamEvents({
					signal: controller.signal,
					onEvent: (event) => received.push(event.type),
				}),
		)

		assert.deepEqual(received, ['status.changed'])
	})

	it('gives up on a handshake that never completes', async () => {
		await withFetch(
			async (_input, init) => fetchThatOnlyAborts(init),
			async () => {
				await assert.rejects(
					createClient(undefined, undefined, 200).streamEvents({
						signal: new AbortController().signal,
						onEvent: () => undefined,
					}),
					(error: unknown) => error instanceof CrewLanApiError && error.kind === 'timeout',
				)
			},
		)
	})
})

describe('CrewLAN API client transport classification', () => {
	it('reports a connection dropped mid-body as a network error, not a bad address', async () => {
		await withFetch(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{"data":'))
							controller.error(new TypeError('terminated'))
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			async () => {
				await assert.rejects(
					createClient().getSession(),
					(error: unknown) => error instanceof CrewLanApiError && error.kind === 'network',
				)
			},
		)
	})

	it('still reports a genuine non-JSON body as a bad address', async () => {
		await withFetch(
			async () => new Response('<html>captive portal</html>', { status: 200 }),
			async () => {
				await assert.rejects(
					createClient().getSession(),
					(error: unknown) => error instanceof CrewLanApiError && error.kind === 'invalid-response',
				)
			},
		)
	})

	it('does not hang when the error body of a rejected stream never completes', async () => {
		const controller = new AbortController()

		await withFetch(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start: () => undefined,
					}),
					{ status: 502, headers: { 'content-type': 'application/json' } },
				),
			async () => {
				await assert.rejects(
					createClient().streamEvents({ signal: controller.signal, onEvent: () => undefined }),
					(error: unknown) => error instanceof CrewLanApiError && error.statusCode === 502,
				)
			},
		)
	})
})

describe('CrewLAN API client macros', () => {
	const macro = {
		id: 'macro-showstart',
		label: 'Show Start',
		colors: { backgroundColor: '#0fcf29', foregroundColor: '#101820' },
		running: false,
		runnable: true,
		sortOrder: 10,
		runStartedAt: null,
		updatedAt: '2026-08-03T18:00:00.000Z',
	}

	it('lists the macros of the workspace', async () => {
		let requestedUrl = ''
		let requestedAuthorization = ''

		const macros = await withFetch(
			async (input, init) => {
				requestedUrl = requestUrl(input)
				requestedAuthorization = String(new Headers(init?.headers).get('authorization') ?? '')

				return jsonResponse({ data: [macro], meta })
			},
			async () => createClient().listMacros(),
		)

		assert.equal(requestedUrl, 'http://127.0.0.1:4848/api/v1/macros')
		assert.equal(requestedAuthorization, 'Bearer cle_test-token')
		assert.equal(macros?.length, 1)
		assert.equal(macros?.[0]?.label, 'Show Start')
	})

	it('reports a CrewLAN without macro support as null instead of failing', async () => {
		const logger = createLogger()

		const macros = await withFetch(
			async () => jsonResponse({ error: 'not_found', message: 'No such CrewLAN resource.' }, 404),
			async () => createClient(logger).listMacros(),
		)

		assert.equal(macros, null)
		assert.equal(logger.debugMessages.length, 1)
	})

	it('still fails on any other error from the macro list', async () => {
		await withFetch(
			async () => jsonResponse({ error: 'unauthorized', message: 'Workspace access is required.' }, 401),
			async () => {
				await assert.rejects(
					createClient().listMacros(),
					(error: unknown) => error instanceof CrewLanApiError && error.statusCode === 401,
				)
			},
		)
	})

	it('rejects a macro list that does not match the expected shape', async () => {
		await withFetch(
			async () => jsonResponse({ data: [{ id: 'macro-1' }], meta }),
			async () => {
				await assert.rejects(
					createClient().listMacros(),
					(error: unknown) => error instanceof CrewLanApiError && error.kind === 'invalid-response',
				)
			},
		)
	})

	it('starts a macro and returns the updated macro', async () => {
		let requestedUrl = ''
		let requestedMethod = ''
		let requestedBody: unknown = 'unset'

		const started = await withFetch(
			async (input, init) => {
				requestedUrl = requestUrl(input)
				requestedMethod = String(init?.method ?? 'GET')
				requestedBody = init?.body

				return jsonResponse({ data: { ...macro, running: true, runStartedAt: '2026-08-03T18:05:00.000Z' }, meta })
			},
			async () => createClient().runMacro('macro-showstart'),
		)

		assert.equal(requestedUrl, 'http://127.0.0.1:4848/api/v1/macros/macro-showstart/run')
		assert.equal(requestedMethod, 'POST')
		assert.equal(requestedBody, undefined)
		assert.equal(started.running, true)
	})

	it('escapes the macro id in the run url', async () => {
		let requestedUrl = ''

		await withFetch(
			async (input) => {
				requestedUrl = requestUrl(input)

				return jsonResponse({ data: macro, meta })
			},
			async () => createClient().runMacro('show start/1'),
		)

		assert.equal(requestedUrl, 'http://127.0.0.1:4848/api/v1/macros/show%20start%2F1/run')
	})

	it('reports a macro that is already running as an ordinary HTTP failure', async () => {
		await withFetch(
			async () => jsonResponse({ error: 'conflict', message: 'That macro is already running.' }, 409),
			async () => {
				await assert.rejects(
					createClient().runMacro('macro-showstart'),
					(error: unknown) =>
						error instanceof CrewLanApiError &&
						error.kind === 'http' &&
						error.statusCode === 409 &&
						error.message === 'That macro is already running.',
				)
			},
		)
	})

	it('subscribes to the macro events only when the host has macro support', async () => {
		const requestedUrls: string[] = []
		const capture: FetchMock = async (input) => {
			requestedUrls.push(requestUrl(input))

			return streamResponse([])
		}

		await withFetch(capture, async () =>
			createClient().streamEvents({ signal: new AbortController().signal, onEvent: () => undefined }),
		)
		await withFetch(capture, async () =>
			createClient().streamEvents({
				signal: new AbortController().signal,
				includeMacroEvents: true,
				onEvent: () => undefined,
			}),
		)

		// CrewLAN rejects a subscription that names an event type it does not know, so asking a host
		// without macros for macro events would take the whole stream down.
		assert.doesNotMatch(requestedUrls[0] ?? '', /macro\./u)
		assert.match(requestedUrls[0] ?? '', /types=status\.changed,alert\.triggered,entity\.controls\.changed$/u)
		assert.match(requestedUrls[1] ?? '', /types=.*macro\.changed,macro\.removed$/u)
	})
})
