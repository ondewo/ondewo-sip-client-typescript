// Copyright 2021-2026 ONDEWO GmbH
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * D18 headless-SDK auth helper (keycloak-migration-plan §7.8 + D18).
 *
 * The provider acquires a Keycloak access token for the PUBLIC SDK client `ondewo-nlu-cai-sdk-public`
 * (no client_secret -- Q1) in one of two ways:
 *
 * - a one-time ROPC login (`grant_type=password`, `scope=offline_access`), or
 * - a handed-off OFFLINE refresh token (`refreshToken`), exchanged with one `grant_type=refresh_token`
 *   request. That path NEVER sends a password grant, not even as a fallback: Keycloak's brute-force
 *   detection counts failed logins, and ondewo runs one client per call container against one realm.
 *
 * The access token is then refreshed proactively by a background loop that wakes 30 s before expiry,
 * and lazily by {@link OfflineTokenProvider.getAuthorizationMetadata}. Both paths share ONE jittered
 * exponential backoff: a failed refresh is never fatal to the loop, a still-valid token keeps being
 * served while the backoff runs, and no request is sent until the backoff has elapsed. The refresh
 * stops after `tokenExpirationInS` (if given) has elapsed since the initial token acquisition.
 *
 * The behaviour is specified once for every ONDEWO client SDK and mirrors the python SDK's
 * `ondewo/nlu/utils/keycloak.py`; constants, grant forms, log lines and error texts are identical.
 *
 * @packageDocumentation
 */

/** Every timing the provider uses, in seconds. Production values are {@link DEFAULT_KEYCLOAK_TOKEN_TIMINGS}. */
export interface KeycloakTokenTimings {
	/** Refresh this long before the access token's `expires_at`. */
	expiryLeewayInS: number;
	/** Floor of any background wait, so an `expires_in` of 0 cannot spin a hot loop. */
	minRefreshDelayInS: number;
	/** First retry delay after a failed refresh. */
	retryBaseDelayInS: number;
	/** Ceiling of the failure backoff. */
	retryMaxDelayInS: number;
	/** Cap of the backoff exponent (`5 * 2^6 = 320 >= 300`), so `2 ** n` cannot overflow. */
	maxRetryExponent: number;
	/** Bound of one whole token-endpoint call (request + body). Must stay below the leeway. */
	httpTimeoutInS: number;
	/** Bound of {@link OfflineTokenProvider.close}'s wait for the background loop. */
	threadJoinTimeoutInS: number;
}

/**
 * The production timings, identical in every ONDEWO client SDK. Tests shrink them per provider through
 * {@link OfflineTokenLoginOptions.timings}; the shared defaults are frozen.
 *
 * The retry base is deliberately far above the 1 s floor: 7.1.1 re-armed the failure path at that floor,
 * which turns a Keycloak outage into a 1 Hz poll per client -- and ondewo runs one client per call
 * container, so the clients that fail together then retry together against a realm they all share.
 */
export const DEFAULT_KEYCLOAK_TOKEN_TIMINGS: Readonly<KeycloakTokenTimings> = Object.freeze({
	expiryLeewayInS: 30,
	minRefreshDelayInS: 1,
	retryBaseDelayInS: 5,
	retryMaxDelayInS: 300,
	maxRetryExponent: 6,
	httpTimeoutInS: 10,
	threadJoinTimeoutInS: 5
});

/** The longest slice of a Keycloak error body quoted in an error (a proxy may answer with a whole HTML page). */
export const MAX_ERROR_BODY_CHARS: number = 500;

/** Largest delay `setTimeout` accepts; a longer one fires after 1 ms (Node's TimeoutOverflowWarning). */
const MAX_TIMER_DELAY_IN_MS: number = 2147483647;

/**
 * Minimal structural type of the fetch Response fields this helper reads. Keeps the module
 * self-contained (no DOM lib dependency) while still typing the injectable `fetchImpl`.
 */
export interface TokenFetchResponse {
	/** Whether the HTTP status is in the 2xx success range. */
	ok: boolean;
	/** The numeric HTTP status code. */
	status: number;
	/**
	 * Read the full response body as text.
	 *
	 * @returns A promise resolving to the raw body string.
	 */
	text(): Promise<string>;
}

/** Init object passed to the injectable fetch. */
export interface TokenFetchInit {
	/** HTTP method (always `"POST"` for the token endpoint). */
	method: string;
	/** Request headers (content-type and accept). */
	headers: Record<string, string>;
	/** The form-encoded request body. */
	body: string;
	/**
	 * Optional undici dispatcher (Node only). The default transport attaches an insecure
	 * `Agent({ connect: { rejectUnauthorized: false } })` here when `verifySsl` is `false`; the global
	 * WHATWG fetch honours it. Never set on an injected `fetchImpl` and ignored in a browser bundle.
	 */
	dispatcher?: unknown;
	/**
	 * Aborted when the call exceeds {@link KeycloakTokenTimings.httpTimeoutInS} (10 s). The global fetch
	 * honours it; an injected `fetchImpl` should too.
	 */
	signal?: AbortSignal;
}

/**
 * Injectable fetch signature (a subset of the global `fetch`) used by the token endpoint call.
 *
 * @param url - The token endpoint URL to POST to.
 * @param init - The request init (method, headers, body, abort signal).
 * @returns A promise resolving to the (structurally minimal) response.
 */
export type TokenFetch = (url: string, init: TokenFetchInit) => Promise<TokenFetchResponse>;

/** Where the provider's WARNING / INFO / DEBUG lines go (the global `console` by default, without DEBUG). */
export interface KeycloakTokenLogger {
	/**
	 * Log a failed refresh (exactly one line per failure).
	 *
	 * @param message - The line; it never contains a credential.
	 */
	warn(message: string): void;
	/**
	 * Log the recovery after failed refreshes.
	 *
	 * @param message - The line; it never contains a credential.
	 */
	info(message: string): void;
	/**
	 * Optional: log that the background loop swallowed an already-recorded failure.
	 *
	 * @param message - The line; it never contains a credential.
	 */
	debug?(message: string): void;
}

/** Options for the D18 headless-SDK offline-token login. */
export interface OfflineTokenLoginOptions {
	/** Base Keycloak URL, e.g. "https://auth.example.com/auth" (trailing slash tolerated). */
	keycloakUrl: string;
	/** Realm name, e.g. "ondewo-ccai-platform". */
	realm: string;
	/** Public SDK client id, e.g. "ondewo-nlu-cai-sdk-public". NO client_secret (Q1). */
	clientId: string;
	/** 2FA-exempt technical-user email. */
	username: string;
	/**
	 * Technical-user password. Pass `''` when authenticating with
	 * {@link OfflineTokenLoginOptions.refreshToken} instead; it is never sent when a refresh token is given.
	 */
	password: string;
	/**
	 * Optional cap (seconds) on how long the auto-refresh runs, measured from the initial token
	 * acquisition (on both the password and the offline-token path). Absent = until the offline session dies.
	 */
	tokenExpirationInS?: number;
	/** Optional fetch override (tests inject a mock); defaults to the global fetch. */
	fetchImpl?: TokenFetch;
	/**
	 * Verify the Keycloak TLS certificate on the token-endpoint call. Default `true` (secure). Set
	 * `false` ONLY for a self-signed local Envoy (e.g. `https://localhost:12001/auth`). Node-only: it is
	 * ignored in a browser bundle (the browser owns TLS) and ignored when a custom `fetchImpl` is
	 * injected. When `false` under Node the default transport attaches an insecure undici dispatcher to
	 * the token request only; it is never a process-wide switch.
	 */
	keycloakVerifySsl?: boolean;
	/** Optional MONOTONIC clock in milliseconds (tests); defaults to `performance.now`. */
	nowInMs?: () => number;
	/**
	 * Optional [0,1) random source for the failure-backoff jitter; defaults to `Math.random`. Consulted
	 * only on the failure path. A value outside [0,1] is clamped.
	 */
	randomFraction?: () => number;
	/** Where the WARNING / INFO lines go; defaults to `console.warn` / `console.info`. */
	logger?: KeycloakTokenLogger;
	/** Test seam: override some timings (seconds). Production code leaves this unset. */
	timings?: Partial<KeycloakTokenTimings>;
	/** Test seam: `false` skips starting the background refresh loop after the initial acquisition. */
	startBackgroundRefresh?: boolean;
	/**
	 * Test seam: the background loop's wait. Resolves `true` to end the loop (as a stop would), `false`
	 * once `delayInS` has elapsed. {@link OfflineTokenProvider.stop} interrupts it either way.
	 */
	waitImpl?: (delayInS: number) => Promise<boolean>;
	/**
	 * A handed-off Keycloak OFFLINE refresh token used instead of a password. When non-empty the
	 * provider starts with one `grant_type=refresh_token` request and never sends a password grant.
	 * SECRET: it mints access tokens for the life of the offline session.
	 */
	refreshToken?: string;
}

/**
 * Error raised on any token-endpoint or token-shape failure: login, refresh, or reading an expired
 * token that cannot be refreshed. Also exported as {@link KeycloakAuthenticationError}, the name every
 * ONDEWO SDK gives this error.
 *
 * Name contract: every instance carries `name === "TokenError"` (set in the constructor, because
 * subclassing `Error` does not propagate the subclass name). Callers may therefore discriminate on
 * `error.name` as well as on `instanceof TokenError` -- the latter being unreliable across bundles.
 * The underlying error, when there is one, is reachable as `cause`. No message contains a credential.
 */
export class TokenError extends Error {
	/** The error this one wraps (a transport rejection, a JSON parse error), when there is one. */
	public cause?: unknown;

	/**
	 * Construct a token error and pin its `name` to `"TokenError"`.
	 *
	 * @param message - Human-readable description of the token failure.
	 * @param cause - The underlying error, if any.
	 */
	public constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'TokenError';
		if (cause !== undefined) {
			this.cause = cause;
		}
	}
}

export { TokenError as KeycloakAuthenticationError };

/**
 * Compute the wait before the next attempt after `consecutiveFailures` failed refreshes: full jitter
 * in `[base, ceiling]`, the ceiling doubling from the base up to the maximum. The jitter is the
 * load-bearing half: N containers whose refreshes fail in the same instant would otherwise retry in
 * lockstep for as long as the outage lasts.
 *
 * @param consecutiveFailures - Failed refreshes so far; values below 1 count as 1.
 * @param randomFraction - Source of a [0,1) fraction; a value outside [0,1] is clamped.
 * @param timings - The timings to use (production defaults when omitted).
 * @returns Seconds to wait before the next attempt.
 */
export function backoffDelayInS(
	consecutiveFailures: number,
	randomFraction: () => number,
	timings: Readonly<KeycloakTokenTimings> = DEFAULT_KEYCLOAK_TOKEN_TIMINGS
): number {
	const exponent: number = Math.min(Math.max(consecutiveFailures, 1) - 1, timings.maxRetryExponent);
	const growthFactor: number = 2 ** exponent;
	const ceilingInS: number = Math.min(timings.retryBaseDelayInS * growthFactor, timings.retryMaxDelayInS);
	const fraction: number = Math.min(Math.max(randomFraction(), 0), 1);
	return timings.retryBaseDelayInS + fraction * (ceilingInS - timings.retryBaseDelayInS);
}

/**
 * Build the OIDC token endpoint URL for a realm, tolerating a trailing slash on `keycloakUrl` and an
 * optional `/auth` relative path already baked into it.
 *
 * @param keycloakUrl - Base Keycloak URL (trailing slashes are stripped).
 * @param realm - Realm name (URL-encoded into the path).
 * @returns The fully-qualified `.../realms/<realm>/protocol/openid-connect/token` endpoint URL.
 */
function buildTokenEndpoint(keycloakUrl: string, realm: string): string {
	const base: string = keycloakUrl.replace(/\/+$/, '');
	return `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

/**
 * Render an error as `<Type>: <message>` for a log line or a wrapping error.
 *
 * @param error - Whatever was thrown.
 * @returns The rendering.
 */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return `${typeof error}: ${String(error)}`;
}

/**
 * Whether a fetch rejection means "the token endpoint could not be reached": a fetch network error (a
 * `TypeError`, per the fetch standard, e.g. undici's `fetch failed`), an abort or timeout, or a Node
 * system error carrying a `code` such as `ECONNREFUSED`. Anything else is a bug in an injected transport.
 *
 * @param error - The rejection.
 * @returns `true` for a transport failure.
 */
function isTransportError(error: unknown): boolean {
	if (error instanceof TypeError) {
		return true;
	}
	if (!(error instanceof Error)) {
		return false;
	}
	return (
		error.name === 'AbortError' ||
		error.name === 'TimeoutError' ||
		typeof (error as { code?: unknown }).code === 'string'
	);
}

/**
 * Name the JSON type of a parsed body for an error message.
 *
 * @param body - The parsed JSON value.
 * @returns `array`, `null`, `string`, `number` or `boolean`.
 */
function jsonTypeName(body: unknown): string {
	if (Array.isArray(body)) {
		return 'array';
	}
	if (body === null) {
		return 'null';
	}
	return typeof body;
}

/**
 * POST an `application/x-www-form-urlencoded` body to the token endpoint and return the parsed JSON
 * object. Every way the exchange can fail surfaces as a {@link TokenError} carrying the original error
 * as `cause`, except a non-transport error thrown by an injected `fetchImpl`, which propagates as is.
 *
 * @param tokenEndpoint - The realm token endpoint URL to POST to.
 * @param params - The form fields to URL-encode into the request body.
 * @param fetchImpl - The fetch transport to use (real or injected mock).
 * @param action - `login` (password grant) or `refresh` (refresh grant), for the error messages.
 * @param httpTimeoutInS - Bound of the whole call, request and body.
 * @returns The parsed JSON object.
 * @throws {TokenError} When the endpoint cannot be reached, answers a non-2xx status or an unusable body.
 */
async function postTokenRequest(
	tokenEndpoint: string,
	params: Record<string, string>,
	fetchImpl: TokenFetch,
	action: string,
	httpTimeoutInS: number
): Promise<Record<string, unknown>> {
	const controller: AbortController = new AbortController();
	const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => {
		const reason: Error = new Error(`the token endpoint did not answer within ${httpTimeoutInS}s`);
		reason.name = 'TimeoutError';
		controller.abort(reason);
	}, httpTimeoutInS * 1000);
	if (typeof timeout.unref === 'function') {
		timeout.unref();
	}
	let response: TokenFetchResponse;
	let text: string;
	try {
		response = await fetchImpl(tokenEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json'
			},
			body: new URLSearchParams(params).toString(),
			signal: controller.signal
		});
		text = await response.text();
	} catch (error: unknown) {
		if (isTransportError(error)) {
			throw new TokenError(
				`Keycloak token ${action} could not reach the token endpoint (${describeError(error)})`,
				error
			);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	if (response.status < 200 || response.status >= 300) {
		throw new TokenError(
			`Keycloak token ${action} failed with status ${response.status}: ${text.slice(0, MAX_ERROR_BODY_CHARS)}`
		);
	}
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch (error: unknown) {
		throw new TokenError(
			`Keycloak token ${action} returned status ${response.status} with a body that is not JSON`,
			error
		);
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new TokenError(`Keycloak token ${action} returned a JSON ${jsonTypeName(body)} instead of an object`);
	}
	return body as Record<string, unknown>;
}

/**
 * Read `expires_in` from a token response: absent = 0, a finite number or a numeric string is taken.
 *
 * @param raw - The `expires_in` field as received.
 * @returns The lifetime in seconds (possibly negative).
 * @throws {TokenError} When the field is present but not numeric. The value is never quoted.
 */
function parseExpiresIn(raw: unknown): number {
	if (raw === undefined) {
		return 0;
	}
	const parsed: number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
	const value: number = typeof raw === 'number' ? raw : parsed;
	if (!Number.isFinite(value)) {
		throw new TokenError('Keycloak token response carried a non-numeric expires_in (value withheld)');
	}
	return value;
}

/** Cached insecure undici dispatcher (built once, reused) so `verifySsl:false` costs one Agent. */
let insecureNodeDispatcher: unknown;

/**
 * Lazily build a cached undici `Agent` that skips TLS certificate verification -- the Node analog of
 * Python's `requests.post(..., verify=False)`. Node-guarded and loaded via a dynamic `import("undici")`
 * so a browser bundle never pulls in `undici` and the flag stays a hard no-op outside Node.
 *
 * @returns The insecure dispatcher under Node, or `undefined` in a browser (TLS is owned by the browser).
 * @throws {Error} When the dynamic `import("undici")` cannot be resolved under Node.
 */
async function getInsecureNodeDispatcher(): Promise<unknown> {
	const nodeProcess: { versions?: { node?: string } } | undefined = (
		globalThis as { process?: { versions?: { node?: string } } }
	).process;
	// Browser guard: outside Node there is no `process`, so the insecure dispatcher is a hard no-op.
	if (nodeProcess === undefined || nodeProcess.versions === undefined || nodeProcess.versions.node === undefined) {
		return undefined;
	}
	if (insecureNodeDispatcher === undefined) {
		const undiciModuleName: string = 'undici';
		const undici: { Agent: new (options: unknown) => unknown } = (await import(undiciModuleName)) as {
			Agent: new (options: unknown) => unknown;
		};
		insecureNodeDispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
	}
	return insecureNodeDispatcher;
}

/**
 * Build the DEFAULT token transport (used only when no `fetchImpl` is injected). It delegates to the
 * global WHATWG fetch, and -- when `verifySsl` is `false` under Node -- attaches an insecure undici
 * dispatcher to the request init so the token POST skips certificate verification. With `verifySsl`
 * `true` (the default) it is a plain pass-through to `globalThis.fetch`, i.e. unchanged behavior.
 *
 * @param verifySsl - Whether to verify the Keycloak TLS certificate; `false` opts into the insecure path.
 * @returns A {@link TokenFetch} that resolves the global fetch at call time (honoring test overrides).
 */
export function createDefaultTokenFetch(verifySsl: boolean): TokenFetch {
	return async (url: string, init: TokenFetchInit): Promise<TokenFetchResponse> => {
		const dispatcher: unknown = verifySsl ? undefined : await getInsecureNodeDispatcher();
		const effectiveInit: TokenFetchInit = dispatcher !== undefined ? { ...init, dispatcher } : init;
		const globalFetch: TokenFetch = globalThis.fetch;
		return globalFetch(url, effectiveInit);
	};
}

/** What {@link OfflineTokenProvider.toJSON} and {@link redactLoginOptions} render in place of a non-empty secret. */
export const REDACTED: string = '***REDACTED***';

/** The logging-safe view of an {@link OfflineTokenProvider}: both tokens redacted. */
export interface OfflineTokenProviderLogView {
	/** The OIDC token endpoint. */
	tokenEndpoint: string;
	/** The Keycloak client id. */
	clientId: string;
	/** `***REDACTED***`, or the token as is when it is `null` (before login) or empty. */
	accessToken: string | null;
	/** `***REDACTED***`, or the token as is when it is `null` (before login) or empty. */
	refreshToken: string | null;
	/** Whether the refresh loop has ended ({@link OfflineTokenProvider.stop}, or the deadline passed). */
	stopped: boolean;
}

/**
 * Redact a token for logging: `null` and `''` render as is, anything else as {@link REDACTED}.
 *
 * @param token - The token to render.
 * @returns The logging-safe rendering.
 */
function redactToken(token: string | null): string | null {
	if (token === null || token === '') {
		return token;
	}
	return REDACTED;
}

/**
 * A logging-safe copy of login options: `password` and `refreshToken` render as `***REDACTED***` when
 * non-empty and stay `''` when empty or absent (so "nobody set it" stays visible), and the function-valued
 * test seams are dropped.
 *
 * @param options - The options to render.
 * @returns A plain object safe to log or `JSON.stringify`.
 */
export function redactLoginOptions(options: OfflineTokenLoginOptions): Record<string, unknown> {
	const view: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(options)) {
		if (typeof value !== 'function') {
			view[key] = value;
		}
	}
	view.password = redactToken(options.password !== undefined ? options.password : '');
	view.refreshToken = redactToken(options.refreshToken !== undefined ? options.refreshToken : '');
	return view;
}

/** The default logger: WARNING and INFO lines on the console, no DEBUG lines. */
const CONSOLE_LOGGER: KeycloakTokenLogger = {
	warn: (message: string): void => {
		console.warn(message);
	},
	info: (message: string): void => {
		console.info(message);
	}
};

/** Providers on which {@link OfflineTokenProvider.stop} was called; the registry never hands one out. */
const CLOSED_PROVIDERS: WeakSet<OfflineTokenProvider> = new WeakSet<OfflineTokenProvider>();

/**
 * A live access-token holder backed by a background refresh loop and a lazy refresh on read. Obtain
 * one from {@link login} (or the shared {@link getKeycloakTokenProvider}); read
 * {@link getAuthorizationMetadata} for each gRPC call (or install {@link createKeycloakAuthClientOptions})
 * and call {@link stop} when done.
 */
export class OfflineTokenProvider {
	/** The realm token endpoint derived from `keycloakUrl` + `realm`. */
	private readonly tokenEndpoint: string;
	/** The public SDK client id sent on every grant. */
	private readonly clientId: string;
	/** Optional cap (seconds) on how long the refresh runs after the initial acquisition. */
	private readonly tokenExpirationInS: number | undefined;
	/** The fetch transport (real global fetch or an injected mock). */
	private readonly fetchImpl: TokenFetch;
	/** Monotonic millisecond clock (injectable for deterministic tests). */
	private readonly nowInMs: () => number;
	/** [0,1) random source used for the failure-backoff jitter (test-injectable). */
	private readonly randomFraction: () => number;
	/** Where the WARNING / INFO / DEBUG lines go. */
	private readonly logger: KeycloakTokenLogger;
	/** The effective timings. */
	private readonly timings: Readonly<KeycloakTokenTimings>;
	/** Whether {@link bootstrap} starts the background loop. */
	private readonly startBackgroundRefresh: boolean;
	/** The background loop's wait (default: an unref'd `setTimeout`). */
	private readonly waitImpl: (delayInS: number) => Promise<boolean>;

	/**
	 * The current access token, or `null` until {@link bootstrap} has completed. It is NEVER reset to
	 * `null` afterwards: neither {@link stop} nor the bounded deadline clears it.
	 */
	private accessToken: string | null;
	/** The current offline refresh token (handed off, or from the login), or `null` before bootstrap. */
	private refreshToken: string | null;
	/** Monotonic second at which the current access token expires. */
	private expiresAtInS: number;
	/** Monotonic second past which the refresh stops, or `null` when unbounded. */
	private deadlineInS: number | null;
	/** The pending timer of the default wait, or `null` when no wait is armed. */
	private timer: ReturnType<typeof setTimeout> | null;
	/** Whether the refresh loop has ended: {@link stop}, or the deadline passed. */
	private stopped: boolean;
	/** Settles the pending wait with `true` when {@link stop} is called. */
	private readonly stopRequested: Promise<boolean>;
	/** Resolves {@link stopRequested}. */
	private resolveStopRequested!: (stopped: boolean) => void;
	/** The running background loop, or `null` when none was started. */
	private loop: Promise<void> | null;
	/** Tail of the promise-chain lock serialising the lazy and the background refresh. */
	private lockTail: Promise<void>;
	/** Optional callback invoked with the error of every failed refresh. */
	private onRefreshErrorHandler: ((error: unknown) => void) | null;
	/** Consecutive failed refreshes; drives the backoff shared by both paths, reset on every success. */
	private consecutiveRefreshFailures: number;
	/** Monotonic second before which no refresh request is sent (0 = no backoff running). */
	private nextRefreshAttemptAtInS: number;

	/**
	 * Construct an (un-bootstrapped) provider from login options. Call {@link bootstrap} (or use the
	 * module-level {@link login}) before reading a token.
	 *
	 * @param options - The D18 headless-SDK offline-token login options.
	 */
	public constructor(options: OfflineTokenLoginOptions) {
		this.tokenEndpoint = buildTokenEndpoint(options.keycloakUrl, options.realm);
		this.clientId = options.clientId;
		this.tokenExpirationInS = options.tokenExpirationInS;
		// A custom fetchImpl always wins (the verifySsl flag is ignored for injected transports); only the
		// DEFAULT transport honors verifySsl, and only under Node. Absent/undefined verifySsl => secure (true).
		const verifySsl: boolean = options.keycloakVerifySsl !== false;
		this.fetchImpl = options.fetchImpl !== undefined ? options.fetchImpl : createDefaultTokenFetch(verifySsl);
		this.nowInMs = options.nowInMs !== undefined ? options.nowInMs : (): number => performance.now();
		this.randomFraction = options.randomFraction !== undefined ? options.randomFraction : Math.random;
		this.logger = options.logger !== undefined ? options.logger : CONSOLE_LOGGER;
		this.timings = { ...DEFAULT_KEYCLOAK_TOKEN_TIMINGS, ...options.timings };
		this.startBackgroundRefresh = options.startBackgroundRefresh !== false;
		this.waitImpl =
			options.waitImpl !== undefined ? options.waitImpl : (delayInS: number): Promise<boolean> => this.wait(delayInS);

		this.accessToken = null;
		this.refreshToken =
			typeof options.refreshToken === 'string' && options.refreshToken !== '' ? options.refreshToken : null;
		this.expiresAtInS = 0;
		this.deadlineInS = null;
		this.timer = null;
		this.stopped = false;
		this.stopRequested = new Promise((resolve: (stopped: boolean) => void): void => {
			this.resolveStopRequested = resolve;
		});
		this.loop = null;
		this.lockTail = Promise.resolve();
		this.onRefreshErrorHandler = null;
		this.consecutiveRefreshFailures = 0;
		this.nextRefreshAttemptAtInS = 0;
	}

	/**
	 * Acquire the initial token and start the background refresh. Awaited by {@link login}.
	 *
	 * With a handed-off `refreshToken` this is ONE refresh grant and the password is never sent, whatever
	 * the outcome; otherwise ONE password grant. A failure is raised; nothing is retried and no background
	 * loop is started.
	 *
	 * @param username - The 2FA-exempt technical-user email.
	 * @param password - The technical-user password (unused on the offline-token path).
	 * @returns A promise that resolves once the initial token is held and the refresh loop is running.
	 * @throws {TokenError} When the token endpoint fails or the response is unusable.
	 */
	public async bootstrap(username: string, password: string): Promise<void> {
		if (this.refreshToken !== null) {
			// Keycloak's brute-force detection counts failed LOGINS, so N containers refreshing one offline
			// token in the same millisecond is not the burst the realm penalises; N password grants is.
			await this.refresh('refresh');
		} else {
			await this.refresh('login', username, password);
		}
		if (this.tokenExpirationInS !== undefined) {
			this.deadlineInS = this.nowInS() + this.tokenExpirationInS;
		}
		if (this.startBackgroundRefresh) {
			this.loop = this.runRefreshLoop();
		}
	}

	/**
	 * The current monotonic time in seconds.
	 *
	 * @returns Seconds on the injected (or default) monotonic clock.
	 */
	private nowInS(): number {
		return this.nowInMs() / 1000;
	}

	/**
	 * Send one grant and store the response. `login` sends the password grant, `refresh` the refresh grant.
	 *
	 * @param action - Which grant to send.
	 * @param username - The username (password grant only).
	 * @param password - The password (password grant only).
	 * @returns A promise resolving once the response is stored.
	 * @throws {TokenError} When the exchange fails or the response is unusable.
	 */
	private async refresh(action: 'login' | 'refresh', username: string = '', password: string = ''): Promise<void> {
		const params: Record<string, string> =
			action === 'login'
				? { grant_type: 'password', client_id: this.clientId, username, password, scope: 'offline_access' }
				: {
						grant_type: 'refresh_token',
						client_id: this.clientId,
						refresh_token: this.refreshToken ?? ''
					};
		const body: Record<string, unknown> = await postTokenRequest(
			this.tokenEndpoint,
			params,
			this.fetchImpl,
			action,
			this.timings.httpTimeoutInS
		);
		this.storeTokens(body);
	}

	/**
	 * Validate a token response and only then store it, so a malformed response changes no state.
	 *
	 * @param body - The parsed token response.
	 * @throws {TokenError} When the response carries no usable `access_token` or a non-numeric `expires_in`.
	 */
	private storeTokens(body: Record<string, unknown>): void {
		const accessToken: unknown = body.access_token;
		if (typeof accessToken !== 'string' || accessToken === '') {
			// Field NAMES only, never values: a token response is made almost entirely of credentials.
			throw new TokenError(
				'Keycloak token response did not contain an access_token; the response carried the fields ' +
					`[${Object.keys(body)
						.sort()
						.map((name: string): string => `'${name}'`)
						.join(', ')}] (values withheld: a token response is credential material)`
			);
		}
		const expiresInS: number = parseExpiresIn(body.expires_in);
		this.accessToken = accessToken;
		// Keycloak may rotate the offline refresh token; keep the previous one when the response has none.
		const refreshToken: unknown = body.refresh_token;
		if (typeof refreshToken === 'string' && refreshToken !== '') {
			this.refreshToken = refreshToken;
		}
		this.expiresAtInS = this.nowInS() + Math.max(expiresInS, 0);
	}

	/**
	 * Run `task` once every earlier task has settled: the promise-chain lock that makes the lazy path
	 * single-flight (16 concurrent callers during an outage send ONE request) and serialises it with
	 * the background loop.
	 *
	 * @param task - The work to run under the lock.
	 * @returns What `task` returned.
	 */
	private withLock<T>(task: () => Promise<T>): Promise<T> {
		const result: Promise<T> = this.lockTail.then(task);
		this.lockTail = result.then(
			(): void => undefined,
			(): void => undefined
		);
		return result;
	}

	/**
	 * Refresh the access token when it is near expiry, the deadline has not passed and no backoff is
	 * running. Shared by the lazy and the background path; callers hold the lock. NEVER a password grant.
	 *
	 * A failed refresh is recorded and backed off, and only RAISED once the token has actually expired:
	 * inside the leeway the token is still valid, so the caller goes out with it.
	 *
	 * @param nowInS - The current monotonic time, sampled by the caller.
	 * @returns A promise resolving when the token may be served.
	 * @throws {TokenError} When the token has expired and could not be refreshed, now or during the backoff.
	 */
	private async refreshIfWithinWindow(nowInS: number): Promise<void> {
		if (this.deadlineInS !== null && nowInS >= this.deadlineInS) {
			return;
		}
		if (nowInS < this.expiresAtInS - this.timings.expiryLeewayInS) {
			return;
		}
		if (nowInS < this.nextRefreshAttemptAtInS) {
			if (nowInS < this.expiresAtInS) {
				return;
			}
			throw new TokenError(
				'The Keycloak access token has expired and the refresh is backing off after ' +
					`${this.consecutiveRefreshFailures} consecutive failure(s); the next attempt is due in ` +
					`${(this.nextRefreshAttemptAtInS - nowInS).toFixed(1)}s`
			);
		}
		try {
			await this.refresh('refresh');
		} catch (error: unknown) {
			this.recordRefreshFailure(error);
			// Re-read the clock: the failed attempt may itself have taken up to the HTTP timeout.
			if (this.nowInS() < this.expiresAtInS) {
				return;
			}
			if (error instanceof TokenError) {
				throw error;
			}
			throw new TokenError(`Keycloak token refresh failed (${describeError(error)})`, error);
		}
		this.recordRefreshSuccess();
	}

	/**
	 * Count a failed refresh, schedule the next attempt with jittered backoff -- measured from NOW, when
	 * the failure is recorded, not from when the attempt started -- log one WARNING and call the
	 * {@link onRefreshError} handler. Deliberately NOT a fallback to a password grant.
	 *
	 * @param error - What the attempt raised; only its type and message are logged.
	 */
	private recordRefreshFailure(error: unknown): void {
		const nowInS: number = this.nowInS();
		this.consecutiveRefreshFailures += 1;
		const delayInS: number = backoffDelayInS(this.consecutiveRefreshFailures, this.randomFraction, this.timings);
		this.nextRefreshAttemptAtInS = nowInS + delayInS;
		const remainingInS: number = this.expiresAtInS - nowInS;
		const validity: string =
			remainingInS > 0
				? `the current access token stays valid for ${remainingInS.toFixed(1)}s`
				: 'the current access token has expired';
		this.logger.warn(
			`Keycloak token refresh failed (attempt ${this.consecutiveRefreshFailures}); retrying in ` +
				`${delayInS.toFixed(1)}s, ${validity} (${describeError(error)})`
		);
		try {
			if (this.onRefreshErrorHandler !== null) {
				this.onRefreshErrorHandler(error);
			}
		} catch {
			// A diagnostics handler that throws is the caller's bug; it must not end the loop or fail a call.
		}
	}

	/** Reset the failure backoff after a successful refresh and log the recovery, if any. */
	private recordRefreshSuccess(): void {
		if (this.consecutiveRefreshFailures > 0) {
			this.logger.info(`Keycloak token refresh recovered after ${this.consecutiveRefreshFailures} failed attempt(s)`);
		}
		this.consecutiveRefreshFailures = 0;
		this.nextRefreshAttemptAtInS = 0;
	}

	/**
	 * The background loop: wait until the leeway before expiry (or, after a failure, until the backoff
	 * allows the next attempt, never at the 1 s floor), then refresh under the lock. A failure NEVER ends
	 * the loop; only {@link stop}, the deadline, or a wait resolving `true` does.
	 *
	 * @returns A promise resolving when the loop has ended.
	 */
	private async runRefreshLoop(): Promise<void> {
		while (!this.stopped) {
			const nowInS: number = this.nowInS();
			if (this.deadlineInS !== null && nowInS >= this.deadlineInS) {
				// The bounded window has closed: stop renewing and let the token lapse.
				this.stopped = true;
				return;
			}
			let delayInS: number = this.expiresAtInS - this.timings.expiryLeewayInS - nowInS;
			if (this.consecutiveRefreshFailures > 0) {
				delayInS = this.nextRefreshAttemptAtInS - nowInS;
			}
			delayInS = Math.max(delayInS, this.timings.minRefreshDelayInS);
			if (this.deadlineInS !== null) {
				delayInS = Math.min(delayInS, this.deadlineInS - nowInS);
			}
			const endLoop: boolean = await Promise.race([this.waitImpl(delayInS), this.stopRequested]);
			if (endLoop || this.stopped) {
				return;
			}
			try {
				await this.withLock((): Promise<void> => this.refreshIfWithinWindow(this.nowInS()));
			} catch (error: unknown) {
				// Already recorded and warned by recordRefreshFailure; never a second warning.
				if (this.logger.debug !== undefined) {
					this.logger.debug(`Keycloak background refresh will be retried (${describeError(error)})`);
				}
			}
		}
	}

	/**
	 * The default wait: an unref'd timer (so it never keeps the process alive) that {@link stop} clears.
	 * A delay above `setTimeout`'s 24.8-day limit is capped; the loop then simply wakes and waits again.
	 *
	 * @param delayInS - Seconds to wait.
	 * @returns A promise resolving `false` when the delay has elapsed.
	 */
	private wait(delayInS: number): Promise<boolean> {
		return new Promise((resolve: (endLoop: boolean) => void): void => {
			this.timer = setTimeout(
				(): void => {
					this.timer = null;
					resolve(false);
				},
				Math.min(delayInS * 1000, MAX_TIMER_DELAY_IN_MS)
			);
			// Node's Timeout exposes unref(); a browser's numeric handle does not, hence the guard.
			if (typeof this.timer.unref === 'function') {
				this.timer.unref();
			}
		});
	}

	/**
	 * Register a callback invoked with the error of every failed refresh (background or lazy). A handler
	 * that throws is ignored.
	 *
	 * @param handler - The callback to receive the refresh error; replaces any previously registered one.
	 */
	public onRefreshError(handler: (error: unknown) => void): void {
		this.onRefreshErrorHandler = handler;
	}

	/**
	 * Read the current access token, WITHOUT refreshing it.
	 *
	 * Once {@link bootstrap} has succeeded this never returns `null` again: when the bounded refresh
	 * loop lapses (or {@link stop} is called) the LAST fetched token keeps being returned even though
	 * it is by then expiring/expired. Prefer {@link getAuthorizationMetadata}, which refreshes on read.
	 *
	 * @returns The current access token, or `null` before {@link bootstrap} has completed.
	 */
	public getAccessToken(): string | null {
		return this.accessToken;
	}

	/**
	 * Build the value for an `Authorization` gRPC metadata header from the current token, WITHOUT
	 * refreshing it (synchronous). Prefer {@link getAuthorizationMetadata}.
	 *
	 * @returns The `Bearer <access_token>` header value.
	 * @throws {TokenError} When no access token has been fetched yet, i.e. {@link bootstrap} /
	 *   {@link login} has not completed. It does NOT throw once the refresh loop has lapsed -- see
	 *   {@link getAccessToken}.
	 */
	public getAuthorizationHeader(): string {
		if (this.accessToken === null) {
			throw new TokenError('No access token available; login() has not completed or has lapsed');
		}
		return `Bearer ${this.accessToken}`;
	}

	/**
	 * The gRPC-web metadata for one call, `{ authorization: 'Bearer <access_token>' }`, refreshing the
	 * token first when it is within 30 s of expiry. Concurrent callers are single-flight. While a failed
	 * refresh backs off, a still-valid token is served and no request is sent; an expired token that
	 * cannot be refreshed raises instead of being handed to a server that would refuse it.
	 *
	 * @returns The metadata object to pass as a generated client method's `metadata` argument.
	 * @throws {TokenError} Before {@link bootstrap}, or when the token has expired and cannot be refreshed.
	 */
	public getAuthorizationMetadata(): Promise<Record<string, string>> {
		return this.withLock(async (): Promise<Record<string, string>> => {
			// Throws before bootstrap, so the refresh below never runs without a token to refresh.
			this.getAuthorizationHeader();
			await this.refreshIfWithinWindow(this.nowInS());
			return { authorization: this.getAuthorizationHeader() };
		});
	}

	/**
	 * A logging-safe view of this provider: the access and refresh tokens render as `***REDACTED***`
	 * (`null` before login and an empty token stay as they are). `JSON.stringify(provider)` uses it, and so
	 * do Node's `console.log(provider)` / `util.inspect(provider)` through the hook below, so none of them
	 * prints a token. {@link OfflineTokenProvider.getAuthorizationHeader} still returns the real one.
	 *
	 * @returns The endpoint, client id and stop flag, with both tokens redacted.
	 */
	public toJSON(): OfflineTokenProviderLogView {
		return {
			tokenEndpoint: this.tokenEndpoint,
			clientId: this.clientId,
			accessToken: redactToken(this.accessToken),
			refreshToken: redactToken(this.refreshToken),
			stopped: this.stopped
		};
	}

	/**
	 * Node's `util.inspect` hook (used by `console.log`): renders {@link OfflineTokenProvider.toJSON}, so
	 * logging the provider never prints a token. Looked up via `Symbol.for`, so no `util` import is needed
	 * and the module stays usable in a browser bundle.
	 *
	 * @returns The redacted view.
	 */
	public [Symbol.for('nodejs.util.inspect.custom')](): OfflineTokenProviderLogView {
		return this.toJSON();
	}

	/**
	 * Stop the background refresh loop. Idempotent; safe from any state, without a loop, and from inside a
	 * refresh callback. It interrupts a pending wait (a backoff wait included) so no further request is
	 * sent, but deliberately KEEPS the last access token readable, and {@link getAuthorizationMetadata}
	 * still refreshes on demand. The shared registry never hands a stopped provider out again.
	 */
	public stop(): void {
		this.stopped = true;
		CLOSED_PROVIDERS.add(this);
		this.resolveStopRequested(true);
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	/**
	 * {@link stop}, then wait at most {@link KeycloakTokenTimings.threadJoinTimeoutInS} (5 s) for the
	 * background loop to finish a refresh that was in flight. Never rejects.
	 *
	 * @returns A promise resolving once the loop has ended or the wait timed out.
	 */
	public async close(): Promise<void> {
		this.stop();
		if (this.loop === null) {
			return;
		}
		let joinTimer: ReturnType<typeof setTimeout> | undefined;
		const timedOut: Promise<void> = new Promise((resolve: () => void): void => {
			joinTimer = setTimeout(resolve, this.timings.threadJoinTimeoutInS * 1000);
		});
		await Promise.race([this.loop, timedOut]);
		clearTimeout(joinTimer);
	}
}

/**
 * Validate login options before any network I/O: the Keycloak triple, the username and one credential.
 *
 * @param options - The options to validate.
 * @throws {TokenError} When the options object, a Keycloak field, the username or both credentials are missing.
 */
function validateLoginOptions(options: OfflineTokenLoginOptions): void {
	if (options === undefined || options === null) {
		throw new TokenError('login() requires an options object');
	}
	const requiredKeys: (keyof OfflineTokenLoginOptions)[] = ['keycloakUrl', 'realm', 'clientId', 'username'];
	for (const key of requiredKeys) {
		const value: unknown = options[key];
		if (typeof value !== 'string' || value.length === 0) {
			const together: string =
				key === 'username'
					? ''
					: '; the Keycloak fields "keycloakUrl", "realm", and "clientId" must be provided together';
			throw new TokenError(`login() option "${key}" is required and must be a non-empty string${together}`);
		}
	}
	const hasPassword: boolean = typeof options.password === 'string' && options.password.length > 0;
	const hasRefreshToken: boolean = typeof options.refreshToken === 'string' && options.refreshToken.length > 0;
	if (!hasPassword && !hasRefreshToken) {
		throw new TokenError(
			'Either the option "password" or the option "refreshToken" (a handed-off Keycloak offline ' +
				'refresh_token) is mandatory in the login() options'
		);
	}
}

/**
 * Acquire a Keycloak access token against the PUBLIC SDK client -- with the handed-off `refreshToken`
 * when given (one refresh grant, the password is never sent), else with a one-time ROPC +
 * offline_access login -- and return a live provider whose token is auto-refreshed until
 * `tokenExpirationInS` elapses.
 *
 * @param options - The headless-SDK login options (`keycloakUrl`, `realm`, `clientId`, `username`, and
 *   `password` or `refreshToken` are required).
 * @returns A bootstrapped {@link OfflineTokenProvider} holding a live access token.
 * @throws {TokenError} When required options are missing/empty, the token endpoint fails, or the
 *   response is unusable.
 */
export async function login(options: OfflineTokenLoginOptions): Promise<OfflineTokenProvider> {
	validateLoginOptions(options);
	const provider: OfflineTokenProvider = new OfflineTokenProvider(options);
	await provider.bootstrap(options.username, options.password !== undefined ? options.password : '');
	return provider;
}

/** Shared providers, keyed by a SHA-256 of the credential set (never by object identity, never raw). */
const PROVIDER_REGISTRY: Map<string, Promise<OfflineTokenProvider>> = new Map<string, Promise<OfflineTokenProvider>>();

/**
 * Derive the registry key of a credential set: the SHA-256 hex digest of every field the provider is
 * built from, joined with NUL. `refreshToken` takes part because two token-only configs carry the same
 * EMPTY password and would otherwise collapse onto one provider -- one tenant authenticating as another.
 *
 * @param options - The login options.
 * @returns A 64-character hex digest that contains no secret.
 */
export async function keycloakTokenProviderRegistryKey(options: OfflineTokenLoginOptions): Promise<string> {
	const fields: string[] = [
		options.keycloakUrl,
		options.realm,
		options.clientId,
		options.username,
		options.password !== undefined ? options.password : '',
		options.tokenExpirationInS !== undefined ? String(options.tokenExpirationInS) : '',
		options.keycloakVerifySsl !== false ? 'True' : 'False',
		options.refreshToken !== undefined ? options.refreshToken : ''
	];
	const digest: ArrayBuffer = await globalThis.crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(fields.join('\0'))
	);
	return Array.from(new Uint8Array(digest), (byte: number): string => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the options configure Keycloak at all: `keycloakUrl`, `realm` and `clientId` all non-empty.
 *
 * @param options - The options to inspect.
 * @returns `true` when the Keycloak triple is complete.
 */
export function isKeycloakConfigured(options: Partial<OfflineTokenLoginOptions>): boolean {
	return Boolean(options.keycloakUrl) && Boolean(options.realm) && Boolean(options.clientId);
}

/**
 * Return the provider shared by every client of one credential set, logging in once (concurrent first
 * callers share that one login). A provider that was stopped is never handed out; a new one replaces it.
 * With NO Keycloak field set it returns `null`: attach no auth metadata (plaintext server, or an ingress
 * that injects auth). A partial Keycloak triple is rejected.
 *
 * @param options - The login options.
 * @returns The shared provider, or `null` when Keycloak is not configured.
 * @throws {TokenError} When the options are invalid or the initial acquisition fails (not cached).
 */
export async function getKeycloakTokenProvider(
	options: OfflineTokenLoginOptions
): Promise<OfflineTokenProvider | null> {
	if (options !== undefined && options !== null && !options.keycloakUrl && !options.realm && !options.clientId) {
		return null;
	}
	validateLoginOptions(options);
	const key: string = await keycloakTokenProviderRegistryKey(options);
	for (;;) {
		let entry: Promise<OfflineTokenProvider> | undefined = PROVIDER_REGISTRY.get(key);
		if (entry === undefined) {
			const created: Promise<OfflineTokenProvider> = login(options);
			entry = created;
			PROVIDER_REGISTRY.set(key, created);
			void created.catch((): void => {
				if (PROVIDER_REGISTRY.get(key) === created) {
					PROVIDER_REGISTRY.delete(key);
				}
			});
		}
		const provider: OfflineTokenProvider = await entry;
		if (!CLOSED_PROVIDERS.has(provider)) {
			return provider;
		}
		if (PROVIDER_REGISTRY.get(key) === entry) {
			PROVIDER_REGISTRY.delete(key);
		}
	}
}

/**
 * Stop every provider in the shared registry and empty it (e.g. on shutdown, or between tests).
 *
 * @returns A promise resolving once every registered provider has been stopped.
 */
export async function clearKeycloakTokenProviderRegistry(): Promise<void> {
	const entries: Promise<OfflineTokenProvider>[] = Array.from(PROVIDER_REGISTRY.values());
	PROVIDER_REGISTRY.clear();
	const settled: PromiseSettledResult<OfflineTokenProvider>[] = await Promise.allSettled(entries);
	for (const result of settled) {
		if (result.status === 'fulfilled') {
			result.value.stop();
		}
	}
}

/** The part of a gRPC-web `Request` the interceptors use (structurally a `grpcWeb.Request`). */
export interface GrpcWebRequestLike {
	/**
	 * The call's mutable metadata.
	 *
	 * @returns The metadata object sent with the call.
	 */
	getMetadata(): Record<string, string>;
}

/**
 * A gRPC-web `UnaryInterceptor` (for the generated `*PromiseClient`s) that attaches
 * `authorization: Bearer <token>` to every call, refreshing the token on read.
 */
export class KeycloakAuthUnaryInterceptor {
	/** The provider whose token is attached. */
	private readonly provider: OfflineTokenProvider;

	/**
	 * Bind the interceptor to a provider.
	 *
	 * @param provider - The provider whose token is attached.
	 */
	public constructor(provider: OfflineTokenProvider) {
		this.provider = provider;
	}

	/**
	 * Attach the bearer token, then continue the call.
	 *
	 * @param request - The outgoing call.
	 * @param invoker - Continues the call.
	 * @returns The call's response.
	 * @throws {TokenError} When the token has expired and cannot be refreshed (the call is not sent).
	 */
	public async intercept<R, T>(request: R & GrpcWebRequestLike, invoker: (request: R) => Promise<T>): Promise<T> {
		Object.assign(request.getMetadata(), await this.provider.getAuthorizationMetadata());
		return invoker(request);
	}
}

/**
 * A gRPC-web `StreamInterceptor` (for the callback `*Client`s and server streams) that attaches the
 * CURRENT bearer token. Stream interceptors are synchronous, so this one cannot refresh on read; the
 * background loop keeps the token fresh.
 */
export class KeycloakAuthStreamInterceptor {
	/** The provider whose token is attached. */
	private readonly provider: OfflineTokenProvider;

	/**
	 * Bind the interceptor to a provider.
	 *
	 * @param provider - The provider whose token is attached.
	 */
	public constructor(provider: OfflineTokenProvider) {
		this.provider = provider;
	}

	/**
	 * Attach the bearer token, then continue the call.
	 *
	 * @param request - The outgoing call.
	 * @param invoker - Continues the call.
	 * @returns The call's stream.
	 */
	public intercept<R, T>(request: R & GrpcWebRequestLike, invoker: (request: R) => T): T {
		request.getMetadata().authorization = this.provider.getAuthorizationHeader();
		return invoker(request);
	}
}

/** Client options that authenticate every call of a generated gRPC-web client. */
export interface KeycloakAuthClientOptions {
	/** Attaches the token to every promise-client call. */
	unaryInterceptors: KeycloakAuthUnaryInterceptor[];
	/** Attaches the token to every callback-client call and stream. */
	streamInterceptors: KeycloakAuthStreamInterceptor[];
}

/**
 * The interceptors that authenticate every call of a generated gRPC-web client; spread them into its
 * options: `new AgentsPromiseClient(hostname, null, { ...options, ...createKeycloakAuthClientOptions(provider) })`.
 *
 * @param provider - The provider whose token is attached.
 * @returns `unaryInterceptors` and `streamInterceptors` for the client options.
 */
export function createKeycloakAuthClientOptions(provider: OfflineTokenProvider): KeycloakAuthClientOptions {
	return {
		unaryInterceptors: [new KeycloakAuthUnaryInterceptor(provider)],
		streamInterceptors: [new KeycloakAuthStreamInterceptor(provider)]
	};
}

// The gRPC-web endpoint / TLS helper ships through this module: the generated public-api re-exports
// only `./auth/offlineTokenProvider`, and `make create_npm_package` compiles this file (tsc follows the
// import), so the helper reaches the package without a proto-compiler change.
export * from './grpcWebEndpoint';
