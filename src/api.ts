import {
	isAnything,
	isPublicMacroDto,
	isPublicMacroDtoList,
	isItemResponse,
	isPublicDismissEntityAlertsDto,
	isPublicEntityControlsDto,
	isPublicEntityDto,
	isPublicEntityStatusDto,
	isPublicEventEnvelope,
	isPublicSessionDto,
	isPublicStatusDtoList,
	isPublicWorkspaceDto,
	type Guard,
} from './guards.js'
import type { ReadableStreamReadResult } from 'node:stream/web'
import type {
	PublicDismissEntityAlertsDto,
	PublicMacroDto,
	PublicEntityControlsDto,
	PublicEntityDto,
	PublicEntityStatusDto,
	PublicEventEnvelope,
	PublicSessionDto,
	PublicStatusDto,
	PublicWorkspaceDto,
} from './types.js'

/**
 * Default deadline for a single REST request.
 *
 * Companion abandons an action after 5 s, and the longest action (set status) makes two calls,
 * so a single request must stay well below that budget.
 */
export const defaultRequestTimeoutMs = 3000
/** Deadline for the best-effort re-read that follows a successful write. */
export const defaultReadBackTimeoutMs = 1500
/** Deadline for reading an error body; a stalled error body must not hang the caller. */
export const errorBodyTimeoutMs = 1000
/** Default deadline for receiving the response headers of the event stream. */
export const defaultStreamConnectTimeoutMs = 10000
/** The event types every CrewLAN knows. */
export const baseEventTypes = ['status.changed', 'alert.triggered', 'entity.controls.changed'] as const
/** The event types only a CrewLAN with macro support knows. */
export const macroEventTypes = ['macro.changed', 'macro.removed'] as const

/**
 * Build the `types` query for the event stream.
 *
 * CrewLAN rejects the whole subscription when it is asked for an event type it does not know, so
 * the macro events are only requested once a host has shown that it has macros.
 */
export function subscribedEventTypes(includeMacros: boolean): string {
	return (includeMacros ? [...baseEventTypes, ...macroEventTypes] : [...baseEventTypes]).join(',')
}
/** Largest amount of undelivered event-stream text the parser will hold before giving up. */
export const maxEventStreamBufferBytes = 1024 * 1024

export type CrewLanApiErrorKind =
	/** The server answered with a non-2xx status. */
	| 'http'
	/** The server could not be reached (DNS, refused, reset, TLS). */
	| 'network'
	/** The request or stream did not produce data within its deadline. */
	| 'timeout'
	/** The caller cancelled the request via its AbortSignal. */
	| 'aborted'
	/** The server answered 2xx but the body was not what the module expects. */
	| 'invalid-response'
	/** A client-side precondition failed (bad address, missing token, ...). */
	| 'client'

export class CrewLanApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number | null = null,
		public readonly kind: CrewLanApiErrorKind = statusCode === null ? 'client' : 'http',
	) {
		super(message)
		this.name = 'CrewLanApiError'
	}
}

export function isAbortError(error: unknown): boolean {
	if (error instanceof CrewLanApiError) {
		return error.kind === 'aborted'
	}

	return error instanceof Error && error.name === 'AbortError'
}

export interface CrewLanApiLogger {
	debug(message: string): void
	warn(message: string): void
}

export interface CrewLanApiClientOptions {
	baseUrl: string
	token: string
	/** Deadline for REST requests; also used for the event-stream handshake. */
	timeoutMs?: number
	logger?: CrewLanApiLogger
}

export interface RequestOptions {
	signal?: AbortSignal
	/** Per-request override of the client deadline. */
	timeoutMs?: number
}

export interface StreamEventsOptions {
	signal: AbortSignal
	onEvent: (event: PublicEventEnvelope) => void
	/** Called once the server accepted the stream (response headers received). */
	onOpen?: () => void
	/**
	 * Abort the stream when no bytes (events or keepalive comments) arrived for this long.
	 * 0 disables the watchdog.
	 */
	idleTimeoutMs?: number
	/** Subscribe to the macro events as well. Only safe against a host that has macro support. */
	includeMacroEvents?: boolean
}

export interface SetEntityStatusResult {
	/** The status id CrewLAN recorded (system ids may be normalised). */
	selectedStatusId: string
	/** The re-read entity status, or null when the re-read failed after a successful write. */
	status: PublicEntityStatusDto | null
}

export interface ControlsPatch {
	shoutbox: {
		listen?: { muted?: boolean }
		talk?: { active?: boolean; controlMode?: 'push' | 'latch' | null }
	}
}

function isSetEntityStatusAck(value: unknown): value is { selectedStatusId: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { selectedStatusId?: unknown }).selectedStatusId === 'string'
	)
}

const silentLogger: CrewLanApiLogger = {
	debug: () => undefined,
	warn: () => undefined,
}

export function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim()

	if (trimmed.length === 0) {
		throw new CrewLanApiError('Address is required.')
	}

	let url: URL

	try {
		url = new URL(trimmed)
	} catch {
		throw new CrewLanApiError('Address must be a valid CrewLAN URL, for example http://192.168.1.20:4848.')
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new CrewLanApiError('Address must start with http:// or https://.')
	}

	// Credentials embedded in the address would otherwise end up in every request URL and log line.
	url.username = ''
	url.password = ''
	// A path is kept so CrewLAN can live behind a reverse proxy sub-path, but a trailing /api or
	// /api/v1 is dropped: users copy that from the browser and it would be sent twice.
	url.pathname = url.pathname.replace(/\/+$/u, '').replace(/\/api(\/v1)?$/u, '')

	url.search = ''
	url.hash = ''
	return url.toString().replace(/\/$/u, '')
}

function describeCause(error: unknown): string {
	if (error instanceof Error) {
		const cause = error.cause

		if (cause instanceof Error && cause.message.length > 0) {
			return cause.message
		}

		return error.message
	}

	return String(error)
}

function truncate(value: string, maxLength = 200): string {
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

/**
 * Incremental parser for a `text/event-stream` body.
 *
 * Lines may end with `\r\n`, `\n` or a lone `\r`, and a chunk boundary may fall between the
 * `\r` and the `\n`; a trailing `\r` is therefore held back until the next chunk arrives.
 * Only the unconsumed tail is retained, so the work per chunk is linear in the chunk size.
 */
export class ServerSentEventParser {
	private buffer = ''
	private dataLines: string[] = []

	constructor(private readonly maxBufferBytes = maxEventStreamBufferBytes) {}

	/** Feed a chunk of text and receive the `data` payloads of every event completed by it. */
	push(chunk: string): string[] {
		this.buffer += chunk

		if (this.buffer.length > this.maxBufferBytes) {
			throw new CrewLanApiError(
				'The CrewLAN event stream sent more than 1 MB without completing an event.',
				null,
				'invalid-response',
			)
		}

		const payloads: string[] = []
		let start = 0

		// `carriageReturn` is only re-scanned once the previous hit is consumed, so a stream that uses
		// plain \n (as CrewLAN does) costs one pass over the chunk rather than one per line.
		let carriageReturn = this.buffer.indexOf('\r', start)

		for (;;) {
			const newline = this.buffer.indexOf('\n', start)

			if (carriageReturn >= 0 && carriageReturn < start) {
				carriageReturn = this.buffer.indexOf('\r', start)
			}

			let end: number
			let terminatorLength: number

			if (carriageReturn >= 0 && (newline < 0 || carriageReturn < newline)) {
				if (carriageReturn === this.buffer.length - 1) {
					// A lone trailing \r may be the first half of \r\n: wait for the next chunk.
					break
				}

				end = carriageReturn
				terminatorLength = this.buffer[carriageReturn + 1] === '\n' ? 2 : 1
			} else if (newline >= 0) {
				end = newline
				terminatorLength = 1
			} else {
				break
			}

			const payload = this.processLine(this.buffer.slice(start, end))

			if (payload !== null) {
				payloads.push(payload)
			}

			start = end + terminatorLength
		}

		this.buffer = this.buffer.slice(start)
		return payloads
	}

	/** Dispatch an event whose final blank line never arrived (end of stream). */
	flush(): string[] {
		const payloads: string[] = []
		const trailing = this.buffer.replace(/\r$/u, '')
		this.buffer = ''

		if (trailing.length > 0) {
			const payload = this.processLine(trailing)

			if (payload !== null) {
				payloads.push(payload)
			}
		}

		const pending = this.processLine('')

		if (pending !== null) {
			payloads.push(pending)
		}

		return payloads
	}

	private processLine(line: string): string | null {
		if (line.length === 0) {
			if (this.dataLines.length === 0) {
				return null
			}

			const payload = this.dataLines.join('\n')
			this.dataLines = []
			return payload
		}

		if (line.startsWith(':')) {
			return null
		}

		const separatorIndex = line.indexOf(':')
		const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
		let fieldValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : ''

		if (fieldValue.startsWith(' ')) {
			fieldValue = fieldValue.slice(1)
		}

		if (field === 'data') {
			this.dataLines.push(fieldValue)
		}

		return null
	}
}

/** Parse a complete block of event-stream text into validated event envelopes. */
export function parseServerSentEvents(chunk: string, logger: CrewLanApiLogger = silentLogger): PublicEventEnvelope[] {
	const parser = new ServerSentEventParser()
	const payloads = [...parser.push(chunk), ...parser.flush()]

	return payloads.flatMap((payload) => {
		const event = decodeEventPayload(payload, logger)
		return event === null ? [] : [event]
	})
}

function decodeEventPayload(payload: string, logger: CrewLanApiLogger): PublicEventEnvelope | null {
	let parsed: unknown

	try {
		parsed = JSON.parse(payload)
	} catch {
		logger.debug(`Ignoring malformed CrewLAN event frame: ${truncate(payload)}`)
		return null
	}

	if (!isPublicEventEnvelope(parsed)) {
		logger.debug(`Ignoring unexpected CrewLAN event frame: ${truncate(payload)}`)
		return null
	}

	return parsed
}

export class CrewLanApiClient {
	readonly baseUrl: string
	private readonly token: string
	private readonly timeoutMs: number
	private readonly streamConnectTimeoutMs: number
	private readonly logger: CrewLanApiLogger

	constructor(options: CrewLanApiClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl)
		this.token = options.token.trim()
		this.timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs
		this.streamConnectTimeoutMs =
			options.timeoutMs === undefined ? defaultStreamConnectTimeoutMs : Math.max(options.timeoutMs, 1)
		this.logger = options.logger ?? silentLogger

		if (this.token.length === 0) {
			throw new CrewLanApiError('CrewLAN entity token is required.')
		}
	}

	async getSession(options: RequestOptions = {}): Promise<PublicSessionDto> {
		return (await this.request('/api/v1/session', {}, options, isItemResponse(isPublicSessionDto))).data
	}

	async getWorkspace(options: RequestOptions = {}): Promise<PublicWorkspaceDto> {
		return (await this.request('/api/v1/workspace', {}, options, isItemResponse(isPublicWorkspaceDto))).data
	}

	async getEntity(entityId: string, options: RequestOptions = {}): Promise<PublicEntityDto> {
		return (await this.request(this.entityPath(entityId), {}, options, isItemResponse(isPublicEntityDto))).data
	}

	async listStatuses(options: RequestOptions = {}): Promise<PublicStatusDto[]> {
		return (await this.request('/api/v1/statuses', {}, options, isItemResponse(isPublicStatusDtoList))).data
	}

	async getEntityStatus(entityId: string, options: RequestOptions = {}): Promise<PublicEntityStatusDto> {
		return (
			await this.request(`${this.entityPath(entityId)}/status`, {}, options, isItemResponse(isPublicEntityStatusDto))
		).data
	}

	/**
	 * Change the entity status. CrewLAN acknowledges the write with the (normalised) selected status
	 * id and the module then re-reads the full status; a failed re-read is reported as `status: null`
	 * rather than as a failure, because the write itself already succeeded.
	 */
	async setEntityStatus(
		entityId: string,
		statusId: string,
		options: RequestOptions = {},
	): Promise<SetEntityStatusResult> {
		const response = await this.request(
			`${this.entityPath(entityId)}/status`,
			{ method: 'PUT', body: JSON.stringify({ statusId }) },
			options,
			isAnything,
		)
		const selectedStatusId = isItemResponse(isSetEntityStatusAck)(response) ? response.data.selectedStatusId : statusId

		try {
			return {
				selectedStatusId,
				status: await this.getEntityStatus(entityId, { ...options, timeoutMs: defaultReadBackTimeoutMs }),
			}
		} catch (error) {
			if (isAbortError(error)) {
				throw error
			}

			this.logger.debug(`Status was set but could not be re-read: ${describeCause(error)}`)
			return { selectedStatusId, status: null }
		}
	}

	async getEntityControls(entityId: string, options: RequestOptions = {}): Promise<PublicEntityControlsDto> {
		return (
			await this.request(
				`${this.entityPath(entityId)}/controls`,
				{},
				options,
				isItemResponse(isPublicEntityControlsDto),
			)
		).data
	}

	async patchEntityControls(
		entityId: string,
		payload: ControlsPatch,
		options: RequestOptions = {},
	): Promise<PublicEntityControlsDto> {
		return (
			await this.request(
				`${this.entityPath(entityId)}/controls`,
				{ method: 'PATCH', body: JSON.stringify(payload) },
				options,
				isItemResponse(isPublicEntityControlsDto),
			)
		).data
	}

	/**
	 * List the workspace macros.
	 *
	 * A CrewLAN without macro support answers 404 on the collection. That is reported as `null`
	 * rather than as a failure, so an older host still connects and simply offers no macro buttons.
	 */
	async listMacros(options: RequestOptions = {}): Promise<PublicMacroDto[] | null> {
		try {
			return (await this.request('/api/v1/macros', {}, options, isItemResponse(isPublicMacroDtoList))).data
		} catch (error) {
			if (error instanceof CrewLanApiError && error.statusCode === 404) {
				this.logger.debug('This CrewLAN has no macro support; macro buttons stay empty.')
				return null
			}

			throw error
		}
	}

	/**
	 * Start a macro. The response carries the updated macro, because a one-shot macro can already
	 * have finished by the time a separate re-read would land.
	 */
	async runMacro(macroId: string, options: RequestOptions = {}): Promise<PublicMacroDto> {
		return (
			await this.request(
				`/api/v1/macros/${encodeURIComponent(macroId)}/run`,
				{ method: 'POST' },
				options,
				isItemResponse(isPublicMacroDto),
			)
		).data
	}

	async dismissEntityAlerts(entityId: string, options: RequestOptions = {}): Promise<PublicDismissEntityAlertsDto> {
		return (
			await this.request(
				`${this.entityPath(entityId)}/alerts/dismiss`,
				{ method: 'POST' },
				options,
				isItemResponse(isPublicDismissEntityAlertsDto),
			)
		).data
	}

	/**
	 * Consume the server-sent event stream until the caller aborts, the server closes it, or the
	 * idle watchdog fires. Resolves on a clean server close and rejects on any error; a caller
	 * abort resolves quietly.
	 */
	async streamEvents(options: StreamEventsOptions): Promise<void> {
		const { signal, onEvent } = options
		const idleTimeoutMs = options.idleTimeoutMs ?? 0
		// The handshake gets a deadline; the open stream is governed only by the caller's signal and
		// the idle watchdog, so the fetch abort must not be tied to a fixed timer.
		const fetchAbort = new AbortController()
		const abortFetch = (): void => fetchAbort.abort()
		signal.addEventListener('abort', abortFetch, { once: true })
		let connectTimedOut = false
		const connectTimer = setTimeout(() => {
			connectTimedOut = true
			fetchAbort.abort()
		}, this.streamConnectTimeoutMs)
		let response: Response

		try {
			response = await fetch(
				`${this.baseUrl}/api/v1/events?types=${subscribedEventTypes(options.includeMacroEvents === true)}`,
				{
					headers: this.headers({ accept: 'text/event-stream' }),
					signal: fetchAbort.signal,
				},
			)
		} catch (error) {
			signal.removeEventListener('abort', abortFetch)

			if (signal.aborted) {
				return
			}

			if (connectTimedOut) {
				throw new CrewLanApiError('CrewLAN did not accept the event stream in time.', null, 'timeout')
			}

			throw new CrewLanApiError(`Could not reach CrewLAN at ${this.baseUrl}: ${describeCause(error)}`, null, 'network')
		} finally {
			clearTimeout(connectTimer)
		}

		if (signal.aborted) {
			signal.removeEventListener('abort', abortFetch)
			await response.body?.cancel().catch(() => undefined)
			return
		}

		if (!response.ok) {
			// The listener stays attached until the error body has been read (or timed out), so a caller
			// abort during that read still tears the request down.
			try {
				throw new CrewLanApiError(await this.errorMessage(response, 'CrewLAN event stream failed'), response.status)
			} finally {
				signal.removeEventListener('abort', abortFetch)
			}
		}

		if (response.body === null) {
			signal.removeEventListener('abort', abortFetch)
			throw new CrewLanApiError('CrewLAN event stream did not provide a response body.', null, 'invalid-response')
		}

		options.onOpen?.()

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		const parser = new ServerSentEventParser()
		// Cancel the body ourselves on abort so a pending read settles even if the transport ignores the signal.
		const cancelOnAbort = (): void => {
			void reader.cancel().catch(() => undefined)
		}
		signal.addEventListener('abort', cancelOnAbort, { once: true })

		try {
			while (!signal.aborted) {
				let result: ReadableStreamReadResult<Uint8Array>

				try {
					result = await readWithIdleTimeout(reader, idleTimeoutMs)
				} catch (error) {
					if (signal.aborted) {
						return
					}

					if (error instanceof CrewLanApiError) {
						throw error
					}

					throw new CrewLanApiError(`CrewLAN event stream failed: ${describeCause(error)}`, null, 'network')
				}

				if (result.done) {
					this.dispatchEvents(parser.flush(), onEvent)
					return
				}

				this.dispatchEvents(parser.push(decoder.decode(result.value, { stream: true })), onEvent)
			}
		} finally {
			signal.removeEventListener('abort', cancelOnAbort)
			signal.removeEventListener('abort', abortFetch)
			await reader.cancel().catch(() => undefined)
		}
	}

	private dispatchEvents(payloads: string[], onEvent: (event: PublicEventEnvelope) => void): void {
		for (const payload of payloads) {
			const event = decodeEventPayload(payload, this.logger)

			if (event === null) {
				continue
			}

			try {
				onEvent(event)
			} catch (error) {
				// One bad frame must not take the whole stream down.
				this.logger.warn(`Failed to apply CrewLAN event "${event.type}": ${describeCause(error)}`)
			}
		}
	}

	private entityPath(entityId: string): string {
		return `/api/v1/entities/${encodeURIComponent(entityId)}`
	}

	private async request<T>(path: string, init: RequestInit, options: RequestOptions, guard: Guard<T>): Promise<T> {
		const timeoutMs = options.timeoutMs ?? this.timeoutMs
		const timeout = AbortSignal.timeout(timeoutMs)
		const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
		const url = `${this.baseUrl}${path}`
		let response: Response

		try {
			response = await fetch(url, {
				...init,
				headers: this.headers({
					accept: 'application/json',
					...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
				}),
				signal,
			})
		} catch (error) {
			throw this.transportError(error, options.signal, timeout, timeoutMs)
		}

		if (!response.ok) {
			throw new CrewLanApiError(await this.errorMessage(response, 'CrewLAN API request failed'), response.status)
		}

		let body: unknown

		try {
			body = await response.json()
		} catch (error) {
			if (options.signal?.aborted === true || timeout.aborted) {
				throw this.transportError(error, options.signal, timeout, timeoutMs)
			}

			// Only a real parse failure means the address points at something that is not the API;
			// a connection dropped mid-body is a transport problem and must stay recoverable.
			if (!(error instanceof SyntaxError)) {
				throw new CrewLanApiError(
					`Lost the connection to CrewLAN at ${this.baseUrl}: ${describeCause(error)}`,
					null,
					'network',
				)
			}

			throw new CrewLanApiError(
				'CrewLAN returned an unexpected (non-JSON) response — check the address.',
				null,
				'invalid-response',
			)
		}

		if (!guard(body)) {
			this.logger.debug(`Unexpected payload from ${path}: ${truncate(JSON.stringify(body))}`)
			throw new CrewLanApiError(`Unexpected response from CrewLAN for ${path}.`, null, 'invalid-response')
		}

		return body
	}

	private transportError(
		error: unknown,
		callerSignal: AbortSignal | undefined,
		timeout: AbortSignal,
		timeoutMs: number,
	): CrewLanApiError {
		if (callerSignal?.aborted === true) {
			return new CrewLanApiError('The request was cancelled.', null, 'aborted')
		}

		if (timeout.aborted) {
			return new CrewLanApiError(`CrewLAN did not respond within ${String(timeoutMs)} ms.`, null, 'timeout')
		}

		return new CrewLanApiError(`Could not reach CrewLAN at ${this.baseUrl}: ${describeCause(error)}`, null, 'network')
	}

	/**
	 * Best-effort read of the server's error message. The body gets its own short deadline because a
	 * stalled error body would otherwise hang the caller with no way to cancel it.
	 */
	private async errorMessage(response: Response, prefix: string): Promise<string> {
		const fallback = `${prefix} with HTTP ${String(response.status)}.`

		try {
			const body: unknown = await Promise.race([
				response.json(),
				new Promise<never>((_resolve, reject) => {
					setTimeout(() => {
						void response.body?.cancel().catch(() => undefined)
						reject(new Error('error body timed out'))
					}, errorBodyTimeoutMs)
				}),
			])

			if (
				typeof body === 'object' &&
				body !== null &&
				'message' in body &&
				typeof body.message === 'string' &&
				body.message.trim().length > 0
			) {
				return body.message
			}
		} catch {
			// Keep the HTTP fallback message.
		}

		return fallback
	}

	private headers(extra: Record<string, string>): Record<string, string> {
		return {
			...extra,
			authorization: `Bearer ${this.token}`,
		}
	}
}

async function readWithIdleTimeout(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
	if (idleTimeoutMs <= 0) {
		return reader.read()
	}

	let timer: NodeJS.Timeout | undefined
	const watchdog = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(
				new CrewLanApiError(
					`No data received from the CrewLAN event stream for ${String(idleTimeoutMs)} ms.`,
					null,
					'timeout',
				),
			)
		}, idleTimeoutMs)
	})

	try {
		return await Promise.race([reader.read(), watchdog])
	} finally {
		clearTimeout(timer)
	}
}
