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

// D18 headless-SDK auth helper (keycloak-migration-plan §7.8 + D18).
//
// One-time ROPC login (grant_type=password, scope=offline_access) against the PUBLIC SDK client
// `ondewo-nlu-cai-sdk-public` (no client_secret -- Q1), then a bounded background loop that refreshes
// the short-lived access token from the offline refresh token before it expires. The current access
// token is exposed for an `Authorization: Bearer <token>` gRPC metadata header. The refresh loop stops
// after `tokenExpirationInS` (if given) has elapsed since login.

/**
 * Seconds of head-room subtracted from a token's `expires_in` so the refresh fires before the access
 * token actually lapses (covers clock skew + the round-trip to Keycloak).
 */
const REFRESH_SKEW_IN_S: number = 30;

/** Lower bound for the scheduled refresh delay so a tiny/zero `expires_in` cannot spin a hot loop. */
const MIN_REFRESH_DELAY_IN_S: number = 1;

/**
 * Minimal structural type of the fetch Response fields this helper reads. Keeps the module
 * self-contained (no DOM lib dependency) while still typing the injectable `fetchImpl`.
 */
export interface TokenFetchResponse {
	/** Whether the HTTP status is in the 2xx success range. */
	ok: boolean;
	/** The numeric HTTP status code (used to build the error message on a non-2xx response). */
	status: number;
	/** Resolves to the raw response body as text, parsed downstream as the Keycloak token JSON. */
	text(): Promise<string>;
}

/** Init object passed to the injectable fetch. */
export interface TokenFetchInit {
	/** HTTP method for the token-endpoint request (always `"POST"`). */
	method: string;
	/** Request headers (the form-encoded content type and a JSON `Accept`). */
	headers: Record<string, string>;
	/** The `application/x-www-form-urlencoded` request body. */
	body: string;
	/**
	 * Optional undici dispatcher (Node only). The default transport attaches an insecure
	 * `Agent({ connect: { rejectUnauthorized: false } })` here when `verifySsl` is `false`; the global
	 * WHATWG fetch honours it. Never set on an injected `fetchImpl` and ignored in a browser bundle.
	 */
	dispatcher?: unknown;
}

/** Injectable fetch signature (a subset of the global `fetch`) used by the token endpoint call. */
export type TokenFetch = (url: string, init: TokenFetchInit) => Promise<TokenFetchResponse>;

/** Parsed Keycloak token-endpoint response (only the fields this helper consumes). */
interface KeycloakTokenResponse {
	/** The short-lived bearer access token used for the `Authorization` gRPC metadata header. */
	access_token: string;
	/** The offline refresh token; absent unless the SDK client granted the `offline_access` scope. */
	refresh_token?: string;
	/** Lifetime of `access_token` in seconds; drives the auto-refresh delay (skew-adjusted). */
	expires_in?: number;
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
	/** Technical-user password. */
	password: string;
	/** Optional cap (seconds) on how long the auto-refresh loop runs after login. */
	tokenExpirationInS?: number;
	/** Optional fetch override (tests inject a mock); defaults to the global fetch. */
	fetchImpl?: TokenFetch;
	/**
	 * Verify the Keycloak TLS certificate on the token-endpoint call. Default `true` (secure). Set
	 * `false` ONLY for a self-signed local Envoy (e.g. `https://localhost:12001/auth`). Node-only: it is
	 * ignored in a browser bundle (the browser owns TLS) and ignored when a custom `fetchImpl` is
	 * injected. When `false` under Node the default transport attaches an insecure undici dispatcher.
	 */
	keycloakVerifySsl?: boolean;
	/** Optional clock override returning epoch ms (tests); defaults to Date.now. */
	nowInMs?: () => number;
}

/** Error raised on any token-endpoint or token-shape failure. */
export class TokenError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'TokenError';
	}
}

/**
 * Build the OIDC token endpoint URL for a realm, tolerating a trailing slash on `keycloakUrl` and an
 * optional `/auth` relative path already baked into it.
 */
function buildTokenEndpoint(keycloakUrl: string, realm: string): string {
	const base: string = keycloakUrl.replace(/\/+$/, '');
	return `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

/**
 * POST an `application/x-www-form-urlencoded` body to the token endpoint and return the parsed JSON.
 * Raises TokenError on a non-2xx response or unparseable / access_token-less body.
 */
async function postTokenRequest(
	tokenEndpoint: string,
	params: Record<string, string>,
	fetchImpl: TokenFetch
): Promise<KeycloakTokenResponse> {
	const body: string = new URLSearchParams(params).toString();
	const response: TokenFetchResponse = await fetchImpl(tokenEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body
	});

	const text: string = await response.text();
	if (!response.ok) {
		throw new TokenError(`Keycloak token endpoint returned HTTP ${response.status}: ${text}`);
	}

	let parsed: KeycloakTokenResponse;
	try {
		parsed = JSON.parse(text) as KeycloakTokenResponse;
	} catch {
		throw new TokenError(`Keycloak token endpoint returned a non-JSON body: ${text}`);
	}
	if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
		throw new TokenError('Keycloak token response did not contain an access_token');
	}
	return parsed;
}

/** Cached insecure undici dispatcher (built once, reused) so `verifySsl:false` costs one Agent. */
let insecureNodeDispatcher: unknown;

/**
 * Lazily build a cached undici `Agent` that skips TLS certificate verification -- the Node analog of
 * Python's `requests.post(..., verify=False)`. Node-guarded and loaded via a dynamic `import("undici")`
 * so a browser bundle never pulls in `undici` and the flag stays a hard no-op outside Node.
 *
 * @returns The insecure dispatcher under Node, or `undefined` in a browser (TLS is owned by the browser).
 */
async function getInsecureNodeDispatcher(): Promise<unknown> {
	const nodeProcess: { versions?: { node?: string } } | undefined = (
		globalThis as { process?: { versions?: { node?: string } } }
	).process;
	/* c8 ignore next 3 -- browser guard: not exercised under the Node test runner */
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

/**
 * A live access-token holder backed by a bounded auto-refresh loop. Obtain one from {@link login};
 * read {@link getAuthorizationHeader} for the gRPC `Authorization` metadata and call {@link stop} when done.
 */
export class OfflineTokenProvider {
	/** Fully-resolved OIDC token endpoint URL for the configured realm. */
	private readonly tokenEndpoint: string;
	/** Public SDK client id sent on every grant (no client_secret accompanies it). */
	private readonly clientId: string;
	/** Optional cap (seconds) on how long the auto-refresh loop runs after login; `undefined` = unbounded. */
	private readonly tokenExpirationInS: number | undefined;
	/** Fetch transport used for the token-endpoint calls (injected in tests, else the global fetch). */
	private readonly fetchImpl: TokenFetch;
	/** Epoch-ms clock used for deadline math (injected in tests, else `Date.now`). */
	private readonly nowInMs: () => number;

	/** The current access token, or `null` before bootstrap / after the bounded loop has lapsed. */
	private accessToken: string | null;
	/** The latest offline refresh token (rotated when Keycloak returns a new one), or `null` pre-bootstrap. */
	private refreshToken: string | null;
	/** Handle of the single armed refresh timer, or `null` when none is scheduled. */
	private timer: ReturnType<typeof setTimeout> | null;
	/** Whether {@link stop} has been called; suppresses any further refresh scheduling. */
	private stopped: boolean;
	/** Epoch-ms instant past which the loop stops renewing, or `null` when unbounded. */
	private deadlineInMs: number | null;
	/** Optional callback invoked with the error of a failed background refresh, or `null` if unregistered. */
	private onRefreshErrorHandler: ((error: unknown) => void) | null;

	public constructor(options: OfflineTokenLoginOptions) {
		this.tokenEndpoint = buildTokenEndpoint(options.keycloakUrl, options.realm);
		this.clientId = options.clientId;
		this.tokenExpirationInS = options.tokenExpirationInS;
		// A custom fetchImpl always wins (the verifySsl flag is ignored for injected transports); only the
		// DEFAULT transport honors verifySsl, and only under Node. Absent/undefined verifySsl => secure (true).
		const verifySsl: boolean = options.keycloakVerifySsl !== false;
		this.fetchImpl = options.fetchImpl !== undefined ? options.fetchImpl : createDefaultTokenFetch(verifySsl);
		this.nowInMs = options.nowInMs !== undefined ? options.nowInMs : Date.now;

		this.accessToken = null;
		this.refreshToken = null;
		this.timer = null;
		this.stopped = false;
		this.deadlineInMs = null;
		this.onRefreshErrorHandler = null;
	}

	/** Perform the one-time ROPC login and arm the first refresh. Awaited by {@link login}. */
	public async bootstrap(username: string, password: string): Promise<void> {
		const tokenResponse: KeycloakTokenResponse = await postTokenRequest(
			this.tokenEndpoint,
			{
				grant_type: 'password',
				client_id: this.clientId,
				username,
				password,
				scope: 'offline_access'
			},
			this.fetchImpl
		);

		this.accessToken = tokenResponse.access_token;
		this.refreshToken = typeof tokenResponse.refresh_token === 'string' ? tokenResponse.refresh_token : null;
		if (this.refreshToken === null) {
			throw new TokenError(
				'Keycloak token response did not contain a refresh_token; the SDK client must have ' +
					'directAccessGrants + the offline_access scope (ondewo-nlu-cai-sdk-public)'
			);
		}

		if (this.tokenExpirationInS !== undefined) {
			const expirationInMs: number = this.tokenExpirationInS * 1000;
			this.deadlineInMs = this.nowInMs() + expirationInMs;
		}
		this.scheduleRefresh(tokenResponse.expires_in);
	}

	/** Exchange the offline refresh token for a fresh access token and re-arm the next refresh. */
	private async refresh(): Promise<void> {
		/* c8 ignore next 3 -- unreachable: stop() always clears the only timer that calls refresh() */
		if (this.stopped) {
			return;
		}
		// Re-check the bounded deadline at fire time (not just at schedule time): once it has elapsed the
		// loop stops with no further renewal -> the access token lapses -> re-login is required.
		if (this.deadlineInMs !== null && this.nowInMs() >= this.deadlineInMs) {
			this.stop();
			return;
		}
		const tokenResponse: KeycloakTokenResponse = await postTokenRequest(
			this.tokenEndpoint,
			{
				grant_type: 'refresh_token',
				client_id: this.clientId,
				refresh_token: this.refreshToken as string
			},
			this.fetchImpl
		);

		this.accessToken = tokenResponse.access_token;
		// Keycloak may rotate the offline refresh token; keep the newest one when present.
		if (typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token.length > 0) {
			this.refreshToken = tokenResponse.refresh_token;
		}
		this.scheduleRefresh(tokenResponse.expires_in);
	}

	/**
	 * Arm a single timer for the next refresh, clamped to the bounded deadline. Stops silently once
	 * `tokenExpirationInS` has elapsed (no further renewal -> access lapses -> re-login required).
	 */
	private scheduleRefresh(expiresInRaw: number | undefined): void {
		if (this.stopped) {
			return;
		}
		const expiresInS: number =
			typeof expiresInRaw === 'number' && expiresInRaw > 0 ? expiresInRaw : MIN_REFRESH_DELAY_IN_S;
		let delayInS: number = Math.max(expiresInS - REFRESH_SKEW_IN_S, MIN_REFRESH_DELAY_IN_S);

		if (this.deadlineInMs !== null) {
			const remainingInMs: number = this.deadlineInMs - this.nowInMs();
			if (remainingInMs <= 0) {
				this.stop();
				return;
			}
			delayInS = Math.min(delayInS, remainingInMs / 1000);
		}

		this.timer = setTimeout(() => {
			this.refresh().catch((refreshError: unknown) => {
				// Swallow a transient refresh failure but surface it so the caller can react; the next
				// gRPC call gets the stale (possibly expired) token and re-logs in on UNAUTHENTICATED.
				if (this.onRefreshErrorHandler !== null) {
					this.onRefreshErrorHandler(refreshError);
				}
			});
		}, delayInS * 1000);
		// Do not keep the event loop alive solely for the refresh timer.
		/* c8 ignore next 3 -- the else branch is unreachable: Node's Timeout always exposes unref() */
		if (typeof this.timer.unref === 'function') {
			this.timer.unref();
		}
	}

	/** Register a callback invoked with the error of a failed background refresh (optional diagnostics). */
	public onRefreshError(handler: (error: unknown) => void): void {
		this.onRefreshErrorHandler = handler;
	}

	/** The current access token, or null before bootstrap / after the bounded loop has lapsed. */
	public getAccessToken(): string | null {
		return this.accessToken;
	}

	/** The value for an `Authorization` gRPC metadata header: `Bearer <access_token>`. */
	public getAuthorizationHeader(): string {
		if (this.accessToken === null) {
			throw new TokenError('No access token available; login() has not completed or has lapsed');
		}
		return `Bearer ${this.accessToken}`;
	}

	/** Stop the auto-refresh loop. Idempotent; safe to call from any state. */
	public stop(): void {
		this.stopped = true;
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}

/**
 * One-time ROPC + offline_access login against the PUBLIC SDK client, returning a live token provider
 * whose access token is auto-refreshed in the background until `tokenExpirationInS` elapses.
 */
export async function login(options: OfflineTokenLoginOptions): Promise<OfflineTokenProvider> {
	if (options === undefined || options === null) {
		throw new TokenError('login() requires an options object');
	}
	const requiredKeys: (keyof OfflineTokenLoginOptions)[] = ['keycloakUrl', 'realm', 'clientId', 'username', 'password'];
	for (const key of requiredKeys) {
		const value: unknown = options[key];
		if (typeof value !== 'string' || value.length === 0) {
			throw new TokenError(`login() option "${key}" is required and must be a non-empty string`);
		}
	}

	const provider: OfflineTokenProvider = new OfflineTokenProvider(options);
	await provider.bootstrap(options.username, options.password);
	return provider;
}
