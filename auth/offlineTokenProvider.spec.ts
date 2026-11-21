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
 * Unit tests for the D18 offline-token helper. The token endpoint is always mocked -- either through
 * the injectable `fetchImpl` option or by temporarily replacing `globalThis.fetch` -- so there is NO
 * network access. Timing is driven by `mock.timers`, never by wall-clock waits.
 *
 * Standalone run:
 *   node --test --experimental-strip-types auth/offlineTokenProvider.spec.ts
 *
 * @module
 */

import { test as runTestCase, mock } from 'node:test';
import assert from 'node:assert/strict';
import { format, inspect } from 'node:util';

import {
	createDefaultTokenFetch,
	login,
	OfflineTokenProvider,
	TokenError,
	type OfflineTokenLoginOptions,
	type TokenFetch,
	type TokenFetchInit,
	type TokenFetchResponse
} from './offlineTokenProvider';

/** Baseline, valid {@link OfflineTokenLoginOptions} reused (and selectively overridden) by every test. */
const BASE_OPTIONS: OfflineTokenLoginOptions = {
	keycloakUrl: 'https://auth.example.com/auth',
	realm: 'ondewo-ccai-platform',
	clientId: 'ondewo-nlu-cai-sdk-public',
	username: 'tech-user@example.com',
	password: 'super-secret',
	// The provider's clock is monotonic (`performance.now`), which `mock.timers` does not advance; the
	// mocked `Date` does, so every timer-driven test sees time move with `mock.timers.tick`.
	nowInMs: (): number => Date.now(),
	logger: { warn: (): void => undefined, info: (): void => undefined }
};

/** The OIDC token endpoint the helper must derive from {@link BASE_OPTIONS} (`keycloakUrl` + `realm`). */
const EXPECTED_TOKEN_ENDPOINT: string =
	'https://auth.example.com/auth/realms/ondewo-ccai-platform/protocol/openid-connect/token';

/** The five {@link OfflineTokenLoginOptions} keys `login()` validates as non-empty strings. */
const REQUIRED_LOGIN_OPTION_KEYS: (keyof OfflineTokenLoginOptions)[] = [
	'keycloakUrl',
	'realm',
	'clientId',
	'username',
	'password'
];

/** The values every required option must be rejected for: missing, empty string, and non-string. */
const INVALID_OPTION_VALUES: unknown[] = [undefined, '', 42];

/** One canned response in the {@link makeFetchStub} queue. */
interface StubResponse {
	/** HTTP status to report (defaults to 200 when omitted). */
	status?: number;
	/** Response payload: an object is JSON-stringified, a string is returned verbatim. */
	body: unknown;
}

/** A single fetch invocation captured by {@link makeFetchStub} for later assertions. */
interface RecordedCall {
	/** The endpoint URL the helper called. */
	url: string;
	/** The request init (method, headers, raw form-encoded body). */
	init: TokenFetchInit;
	/** The parsed form-encoded request body for convenient field assertions. */
	params: URLSearchParams;
}

/** The mock fetch plus the list it records every call into. */
interface FetchStub {
	/** The injectable mock to pass as `fetchImpl`. */
	fetchImpl: TokenFetch;
	/** Every call the mock received, in order. */
	calls: RecordedCall[];
}

/**
 * Structural view of the private members a few tests must reach directly, because the code paths they
 * guard (the post-`stop()` re-entry guard and the non-Node timer handle) cannot be produced through
 * the public API alone.
 */
interface ProviderInternals {
	/**
	 * The private background-refresh loop.
	 *
	 * @returns A promise resolving once the loop has ended (or returned early).
	 */
	runRefreshLoop(): Promise<void>;
	/**
	 * The private default wait, which arms the timer.
	 *
	 * @param delayInS - Seconds to wait.
	 * @returns A promise resolving `false` once the delay has elapsed.
	 */
	wait(delayInS: number): Promise<boolean>;
	/** The currently armed timer handle, or `null` when nothing is armed. */
	timer: unknown;
}

/** Mutable view of the `process` global, so {@link withoutNodeProcess} can remove it temporarily. */
interface GlobalWithProcess {
	/** Node's `process` global; absent in a browser, which is what the module's guard keys off. */
	process?: unknown;
}

/** A recording wrapper installed over the global `clearTimeout` by {@link spyOnClearTimeout}. */
interface ClearTimeoutSpy {
	/** Every handle the code under test passed to `clearTimeout` while the spy was installed, in order. */
	cancelledHandles: unknown[];
	/** Uninstall the wrapper and put the previously installed global `clearTimeout` back. */
	restore(): void;
}

/**
 * Build a fake fetch that returns a sequence of JSON responses (one per call) and records the
 * requests it received, so assertions can inspect the form-encoded body and the URL.
 *
 * @param responses - The canned responses to return, consumed in order; calling the mock more
 *   times than there are responses throws.
 * @returns A {@link FetchStub} bundling the mock and its recorded-call list.
 * @throws {Error} From the returned mock, when it is called more often than there are responses.
 */
function makeFetchStub(responses: StubResponse[]): FetchStub {
	const calls: RecordedCall[] = [];
	const fetchImpl: TokenFetch = (url: string, init: TokenFetchInit): Promise<TokenFetchResponse> => {
		calls.push({ url, init, params: new URLSearchParams(init.body) });
		const next: StubResponse | undefined = responses.shift();
		if (next === undefined) {
			throw new Error('fetch stub called more times than expected');
		}
		const status: number = next.status !== undefined ? next.status : 200;
		const bodyText: string = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
		return Promise.resolve({
			ok: status >= 200 && status < 300,
			status,
			text: (): Promise<string> => Promise.resolve(bodyText)
		});
	};
	return { fetchImpl, calls };
}

/**
 * Yield to the microtask queue so an awaited refresh inside a fired timer can settle.
 *
 * @returns A promise that resolves on the next tick of the event loop.
 */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve: () => void): void => {
		setImmediate(resolve);
	});
}

/**
 * Build a validator for `assert.rejects` / `assert.throws` that pins the thrown value to a
 * {@link TokenError} carrying the documented `name` and a matching message -- so a test cannot pass on
 * an unrelated failure that merely happens to reject.
 *
 * @param messagePattern - Pattern the error message must match.
 * @returns A validator returning `true` for a matching {@link TokenError}.
 * @throws {assert.AssertionError} From the returned validator, when the value is not a matching TokenError.
 */
function expectTokenError(messagePattern: RegExp): (error: unknown) => boolean {
	return (error: unknown): boolean => {
		assert.ok(error instanceof TokenError, `expected a TokenError, got: ${String(error)}`);
		assert.equal(error.name, 'TokenError');
		assert.match(error.message, messagePattern);
		return true;
	};
}

/**
 * Reinterpret a provider as its private surface, for the tests that must invoke or inspect private members.
 *
 * @param provider - The provider whose internals are needed.
 * @returns The same instance typed as {@link ProviderInternals}.
 */
function internalsOf(provider: OfflineTokenProvider): ProviderInternals {
	return provider as unknown as ProviderInternals;
}

/**
 * Read the `connect.rejectUnauthorized` TLS option out of the undici `Agent` the default transport
 * attached to a request init.
 *
 * That flag IS the `keycloakVerifySsl:false` feature, yet it is invisible on the dispatcher's public
 * surface: a certificate-VERIFYING Agent is an `Agent` too, so a constructor-name assertion holds either
 * way. undici keeps the constructor options on a symbol-keyed property (`Symbol(options)` as of undici
 * 6/7), so every own key -- symbol AND string -- is scanned for the first value carrying a boolean
 * `connect.rejectUnauthorized`. A renamed or relocated key therefore makes this helper fail loudly
 * instead of silently degrading into a vacuous assertion.
 *
 * @param dispatcher - The dispatcher found on the request init (an undici `Agent`).
 * @returns The dispatcher's `connect.rejectUnauthorized` value.
 * @throws {assert.AssertionError} When the dispatcher carries no `connect.rejectUnauthorized` option.
 */
function readRejectUnauthorized(dispatcher: unknown): boolean {
	const ownKeys: (string | symbol)[] = Reflect.ownKeys(dispatcher as object);
	for (const key of ownKeys) {
		const agentOptions: unknown = (dispatcher as Record<string | symbol, unknown>)[key];
		if (typeof agentOptions !== 'object' || agentOptions === null) {
			continue;
		}
		const connectOptions: unknown = (agentOptions as { connect?: unknown }).connect;
		if (typeof connectOptions !== 'object' || connectOptions === null) {
			continue;
		}
		const rejectUnauthorized: unknown = (connectOptions as { rejectUnauthorized?: unknown }).rejectUnauthorized;
		if (typeof rejectUnauthorized === 'boolean') {
			return rejectUnauthorized;
		}
	}
	return assert.fail(
		`the dispatcher carries no connect.rejectUnauthorized option; own keys: ${ownKeys.map(String).join(', ')}`
	);
}

/**
 * Install a recording wrapper over the global `clearTimeout` that still delegates to the previously
 * installed implementation (the `mock.timers` one while fake timers are enabled).
 *
 * `stop()` DISARMING the pending timer is otherwise unobservable: it nulls the handle field in the same
 * breath, and `refresh()`'s own `stopped` guard swallows a timer that was left armed and later fires --
 * so neither a fetch-call count nor the handle field can tell a cancelled timer from a live one. The
 * wrapper makes the cancellation itself assertable.
 *
 * @returns The installed {@link ClearTimeoutSpy}; call its `restore()` before `mock.timers.reset()`.
 */
function spyOnClearTimeout(): ClearTimeoutSpy {
	const cancelledHandles: unknown[] = [];
	const originalClearTimeout: typeof globalThis.clearTimeout = globalThis.clearTimeout;
	globalThis.clearTimeout = (handle: Parameters<typeof globalThis.clearTimeout>[0]): void => {
		cancelledHandles.push(handle);
		originalClearTimeout(handle);
	};
	return {
		cancelledHandles,
		restore: (): void => {
			globalThis.clearTimeout = originalClearTimeout;
		}
	};
}

/**
 * Invoke `call` with Node's `process` global temporarily removed and restore it before the caller
 * awaits the result. Only the SYNCHRONOUS prefix of `call` runs without `process` -- which is exactly
 * where the module's browser guard reads it. Anything after the first `await` (notably the
 * `globalThis.fetch` lookup) still sees a fully intact global environment.
 *
 * @param call - The function to invoke while `process` is absent.
 * @returns The promise `call` returned, still pending; `process` is already restored when it settles.
 */
function withoutNodeProcess<T>(call: () => Promise<T>): Promise<T> {
	const globalWithProcess: GlobalWithProcess = globalThis;
	const originalProcess: unknown = globalWithProcess.process;
	try {
		delete globalWithProcess.process;
		return call();
	} finally {
		globalWithProcess.process = originalProcess;
	}
}

runTestCase(
	'login posts ROPC + offline_access to the realm token endpoint with the public client (no secret)',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 300 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });

			assert.equal(stub.calls.length, 1);
			assert.equal(stub.calls[0].url, EXPECTED_TOKEN_ENDPOINT);
			assert.equal(stub.calls[0].init.method, 'POST');
			assert.deepEqual(stub.calls[0].init.headers, {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json'
			});

			const params: URLSearchParams = stub.calls[0].params;
			// The password grant sends EXACTLY these five fields -- nothing more, nothing less.
			assert.deepEqual([...params.keys()].sort(), ['client_id', 'grant_type', 'password', 'scope', 'username']);
			assert.equal(params.get('grant_type'), 'password');
			assert.equal(params.get('client_id'), 'ondewo-nlu-cai-sdk-public');
			assert.equal(params.get('username'), 'tech-user@example.com');
			assert.equal(params.get('password'), 'super-secret');
			assert.equal(params.get('scope'), 'offline_access');
			// Q1: PUBLIC client -- there must be NO client_secret on the wire.
			assert.equal(params.get('client_secret'), null);

			assert.equal(provider.getAccessToken(), 'access-1');
			assert.equal(provider.getAuthorizationHeader(), 'Bearer access-1');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('the token endpoint tolerates trailing slashes and URL-encodes the realm', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 300 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			keycloakUrl: 'https://auth.example.com/auth///',
			realm: 'ondewo ccai/platform',
			fetchImpl: stub.fetchImpl
		});

		assert.equal(
			stub.calls[0].url,
			'https://auth.example.com/auth/realms/ondewo%20ccai%2Fplatform/protocol/openid-connect/token'
		);
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase(
	'auto-refresh exchanges the offline refresh_token for a fresh access token before expiry',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } },
			{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } }
		]);

		// expires_in 31 - 30 skew = 1s scheduled delay; drive it deterministically via fake timers.
		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
			assert.equal(provider.getAccessToken(), 'access-1');

			mock.timers.tick(1000);
			await flushMicrotasks();

			assert.equal(stub.calls.length, 2);
			assert.equal(stub.calls[1].url, EXPECTED_TOKEN_ENDPOINT);
			assert.deepEqual(stub.calls[1].init.headers, {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json'
			});

			const refreshParams: URLSearchParams = stub.calls[1].params;
			// The refresh grant sends EXACTLY these three fields (no username/password, no scope).
			assert.deepEqual([...refreshParams.keys()].sort(), ['client_id', 'grant_type', 'refresh_token']);
			assert.equal(refreshParams.get('grant_type'), 'refresh_token');
			assert.equal(refreshParams.get('refresh_token'), 'offline-1');
			assert.equal(refreshParams.get('client_id'), 'ondewo-nlu-cai-sdk-public');
			assert.equal(refreshParams.get('client_secret'), null);

			assert.equal(provider.getAccessToken(), 'access-2');
			assert.equal(provider.getAuthorizationHeader(), 'Bearer access-2');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('the refresh fires at expires_in minus the 30s skew (300s => 270s)', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 300 } },
		{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 300 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });

		// One millisecond short of 300s - 30s skew: the refresh must NOT have fired yet.
		mock.timers.tick(269_999);
		await flushMicrotasks();
		assert.equal(stub.calls.length, 1, 'the refresh fired before expires_in - REFRESH_SKEW_IN_S');

		mock.timers.tick(1);
		await flushMicrotasks();
		assert.equal(stub.calls.length, 2, 'the refresh did not fire at exactly expires_in - REFRESH_SKEW_IN_S');
		assert.equal(provider.getAccessToken(), 'access-2');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase('the scheduled delay is clamped to the remaining bounded lifetime', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 3600 } },
		{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 3600 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			fetchImpl: stub.fetchImpl,
			tokenExpirationInS: 5
		});

		mock.timers.tick(4999);
		await flushMicrotasks();
		assert.equal(provider.toJSON().stopped, false, 'the loop ended before the clamped 5s deadline');

		// The wait was clamped to the 5 s deadline (not expires_in - skew = 3570 s): the loop wakes at the
		// deadline and ends there without renewing.
		mock.timers.tick(1);
		await flushMicrotasks();
		assert.equal(provider.toJSON().stopped, true, 'the wait was not clamped to the remaining bounded lifetime');
		assert.equal(stub.calls.length, 1);
		assert.equal(provider.getAccessToken(), 'access-1');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase('the refresh loop stops after tokenExpirationInS elapses (no further renewal)', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
	]);

	let fakeNowInMs: number = 1_000_000;
	const nowInMs: () => number = (): number => fakeNowInMs;

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		// Bound the loop to 2s; the first refresh is armed at ~1s but the deadline passes before it fires.
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			fetchImpl: stub.fetchImpl,
			nowInMs,
			tokenExpirationInS: 2
		});

		// Advance the wall clock past the deadline before the timer fires.
		fakeNowInMs += 3000;
		mock.timers.tick(1000);
		await flushMicrotasks();

		// Deadline already passed -> refresh must NOT have fired; only the initial login call happened.
		assert.equal(stub.calls.length, 1);
		// Current behavior: a lapsed loop does NOT clear the (by now expiring) token.
		assert.equal(provider.getAccessToken(), 'access-1');
		assert.equal(provider.getAuthorizationHeader(), 'Bearer access-1');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase(
	'the refresh loop stops when the deadline is reached EXACTLY (>= , not >) at fire time',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);

		let fakeNowInMs: number = 7_000_000;
		const nowInMs: () => number = (): number => fakeNowInMs;

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			// Bound the loop to 2s; the refresh is armed at ~1s.
			const provider: OfflineTokenProvider = await login({
				...BASE_OPTIONS,
				fetchImpl: stub.fetchImpl,
				nowInMs,
				tokenExpirationInS: 2
			});

			// Land the injected clock EXACTLY on the deadline (7_000_000 + 2s) -- the boundary instant that
			// separates `nowInMs() >= deadlineInMs` from a `>` comparison -- and then fire the timer.
			fakeNowInMs += 2000;
			mock.timers.tick(1000);
			await flushMicrotasks();

			// Deadline REACHED (not merely passed) => the loop stops: no renewal, no re-armed timer.
			assert.equal(stub.calls.length, 1, 'the refresh renewed the token at the exact deadline instant');
			assert.equal(internalsOf(provider).timer, null, 'the lapsed loop left a refresh timer armed');
			assert.equal(provider.getAccessToken(), 'access-1');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('login rejects a non-2xx token response with TokenError', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([{ status: 401, body: { error: 'invalid_grant' } }]);
	await assert.rejects(
		(): Promise<OfflineTokenProvider> => login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl }),
		expectTokenError(/^Keycloak token login failed with status 401: \{"error":"invalid_grant"\}$/)
	);
});

runTestCase(
	'a login response without a refresh_token is ACCEPTED (spec S3) and the refresh then sends an empty one',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', expires_in: 31 } },
			{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } },
			{ body: { access_token: 'access-3', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			// Like the python SDK: no refresh_token keeps the previous (still empty) value, it is no error.
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
			assert.equal(provider.getAccessToken(), 'access-1');
			assert.equal(stub.calls.length, 1);

			mock.timers.tick(1000);
			await flushMicrotasks();
			assert.equal(stub.calls[1].params.get('grant_type'), 'refresh_token');
			assert.equal(stub.calls[1].params.get('refresh_token'), '');
			assert.equal(provider.getAccessToken(), 'access-2');

			mock.timers.tick(1000);
			await flushMicrotasks();
			// The rotated offline-2 was adopted and is kept when the next response carries none.
			assert.equal(stub.calls[2].params.get('refresh_token'), 'offline-2');
			assert.equal(provider.getAccessToken(), 'access-3');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase(
	'a login response whose refresh_token is not a string is ACCEPTED and the value is NOT adopted',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 42, expires_in: 31 } },
			{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
			assert.equal(provider.getAccessToken(), 'access-1');

			mock.timers.tick(1000);
			await flushMicrotasks();
			assert.equal(stub.calls[1].params.get('refresh_token'), '');
			assert.equal(provider.getAccessToken(), 'access-2');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase(
	'login rejects every required option when it is missing, empty or not a string',
	async (): Promise<void> => {
		for (const key of REQUIRED_LOGIN_OPTION_KEYS) {
			for (const invalidValue of INVALID_OPTION_VALUES) {
				const stub: FetchStub = makeFetchStub([]);
				const options: OfflineTokenLoginOptions = {
					...BASE_OPTIONS,
					fetchImpl: stub.fetchImpl,
					[key]: invalidValue
				};

				await assert.rejects(
					(): Promise<OfflineTokenProvider> => login(options),
					expectTokenError(
						key === 'password'
							? /^Either the option "password" or the option "refreshToken" \(a handed-off Keycloak offline refresh_token\) is mandatory/
							: new RegExp(`^login\\(\\) option "${key}" is required and must be a non-empty string`)
					)
				);
				// Validation must happen BEFORE any network call.
				assert.equal(stub.calls.length, 0);
			}
		}
	}
);

runTestCase('getAuthorizationHeader throws before bootstrap when no token is available', (): void => {
	const stub: FetchStub = makeFetchStub([]);
	const provider: OfflineTokenProvider = new OfflineTokenProvider({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
	assert.throws(
		(): string => provider.getAuthorizationHeader(),
		expectTokenError(/^No access token available; login\(\) has not completed or has lapsed$/)
	);
	assert.equal(provider.getAccessToken(), null);
});

runTestCase('TokenError is an Error subclass whose name is pinned to "TokenError"', (): void => {
	const error: TokenError = new TokenError('something went wrong');
	assert.ok(error instanceof Error);
	assert.ok(error instanceof TokenError);
	assert.equal(error.name, 'TokenError');
	assert.equal(error.message, 'something went wrong');
});

runTestCase('login rejects a 2xx token response whose body is not valid JSON', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([{ body: '<<<not-json>>>' }]);
	await assert.rejects(
		(): Promise<OfflineTokenProvider> => login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl }),
		expectTokenError(/^Keycloak token login returned status 200 with a body that is not JSON$/)
	);
});

runTestCase('login rejects a parseable token response that carries no access_token', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([{ body: { refresh_token: 'offline-1', expires_in: 300 } }]);
	await assert.rejects(
		(): Promise<OfflineTokenProvider> => login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl }),
		expectTokenError(/^Keycloak token response did not contain an access_token; the response carried the fields \[/)
	);
});

runTestCase('login rejects a token response whose access_token is an empty string', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([{ body: { access_token: '', refresh_token: 'offline-1', expires_in: 300 } }]);
	await assert.rejects(
		(): Promise<OfflineTokenProvider> => login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl }),
		expectTokenError(/^Keycloak token response did not contain an access_token; the response carried the fields \[/)
	);
});

runTestCase(
	'an empty refresh_token string at login is NOT adopted (spec S3) and the refresh sends an empty one',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: '', expires_in: 31 } },
			{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			// `''` is not adopted; the previous value is kept, and there was none.
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
			assert.equal(provider.getAccessToken(), 'access-1');

			mock.timers.tick(1000);
			await flushMicrotasks();

			assert.equal(stub.calls[1].params.get('refresh_token'), '');
			assert.equal(provider.getAccessToken(), 'access-2');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('login rejects a missing options object', async (): Promise<void> => {
	await assert.rejects(
		(): Promise<OfflineTokenProvider> => login(null as unknown as OfflineTokenLoginOptions),
		expectTokenError(/^login\(\) requires an options object$/)
	);
	await assert.rejects(
		(): Promise<OfflineTokenProvider> => login(undefined as unknown as OfflineTokenLoginOptions),
		expectTokenError(/^login\(\) requires an options object$/)
	);
});

runTestCase('a failed background refresh is surfaced, re-arms the timer and recovers', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } },
		{ status: 500, body: 'boom' },
		{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		// randomFraction 0 puts the retry at the base of its window, so the delay is exactly
		// REFRESH_RETRY_BASE_DELAY_IN_S rather than drawn.
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			fetchImpl: stub.fetchImpl,
			randomFraction: (): number => 0
		});
		let captured: unknown = null;
		provider.onRefreshError((error: unknown): void => {
			captured = error;
		});

		mock.timers.tick(1000);
		await flushMicrotasks();
		await flushMicrotasks();

		assert.ok(captured instanceof TokenError);
		assert.equal(captured.name, 'TokenError');
		assert.equal(captured.message, 'Keycloak token refresh failed with status 500: boom');
		// The transient failure must NOT clobber the still-valid access token.
		assert.equal(provider.getAccessToken(), 'access-1');

		// The failed refresh MUST re-arm the timer. `refresh()` reschedules on its last line,
		// which is after the `await` that threw, so the catch is the only thing that can keep
		// proactive renewal alive -- and before this was fixed a single transient 5xx ended it
		// for the life of the provider, leaving every later token to the UNAUTHENTICATED
		// fallback. The re-arm waits the failure-backoff base (5 s): 7.1.1 used
		// MIN_REFRESH_DELAY_IN_S here, which polled the endpoint once a second for a whole outage.
		mock.timers.tick(4999);
		await flushMicrotasks();
		assert.equal(stub.calls.length, 2, 'the retry fired before the backoff base elapsed');

		mock.timers.tick(1);
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 3, 'the refresh loop did not re-arm after a failure');
		// ...and having re-armed, it recovers: the transient failure self-heals.
		assert.equal(provider.getAccessToken(), 'access-2');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase(
	'a failed background refresh without a registered handler is swallowed silently',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } },
			{ status: 503, body: 'down' }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });

			mock.timers.tick(1000);
			await flushMicrotasks();
			await flushMicrotasks();

			// No handler -> the rejection is swallowed; the stale token survives and nothing throws.
			assert.equal(provider.getAccessToken(), 'access-1');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase(
	'a refresh response without a rotated refresh_token keeps reusing the previous one',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } },
			// First refresh succeeds but Keycloak does NOT rotate the offline token.
			{ body: { access_token: 'access-2', expires_in: 31 } },
			{ body: { access_token: 'access-3', refresh_token: 'offline-3', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });

			mock.timers.tick(1000);
			await flushMicrotasks();
			assert.equal(provider.getAccessToken(), 'access-2');

			mock.timers.tick(1000);
			await flushMicrotasks();
			// The second refresh must still send the original offline-1 token (it was never rotated).
			assert.equal(stub.calls[2].params.get('refresh_token'), 'offline-1');
			assert.equal(provider.getAccessToken(), 'access-3');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase(
	'a refresh response whose rotated refresh_token is an EMPTY string keeps the previous one',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } },
			// The rotation guard needs BOTH halves: `''` is a string, so only the `.length > 0` half rejects it.
			{ body: { access_token: 'access-2', refresh_token: '', expires_in: 31 } },
			{ body: { access_token: 'access-3', refresh_token: 'offline-3', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });

			mock.timers.tick(1000);
			await flushMicrotasks();
			assert.equal(stub.calls[1].params.get('refresh_token'), 'offline-1');
			assert.equal(provider.getAccessToken(), 'access-2');

			mock.timers.tick(1000);
			await flushMicrotasks();
			// The empty rotation was IGNORED: the still-valid offline-1 token is sent again, not ''.
			assert.equal(stub.calls[2].params.get('refresh_token'), 'offline-1');
			assert.equal(provider.getAccessToken(), 'access-3');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('an absent/zero expires_in falls back to the minimum refresh delay', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		// No expires_in -> the scheduler must clamp to MIN_REFRESH_DELAY_IN_S (1s), not spin a hot loop.
		{ body: { access_token: 'access-1', refresh_token: 'offline-1' } },
		{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
		assert.equal(provider.getAccessToken(), 'access-1');

		// Nothing may fire before the 1s minimum...
		mock.timers.tick(999);
		await flushMicrotasks();
		assert.equal(stub.calls.length, 1);

		// ... and the refresh must fire exactly at it.
		mock.timers.tick(1);
		await flushMicrotasks();

		assert.equal(stub.calls.length, 2);
		assert.equal(provider.getAccessToken(), 'access-2');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase(
	'a non-positive tokenExpirationInS lapses the loop immediately at schedule time',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);

		let fakeNowInMs: number = 5_000_000;
		const nowInMs: () => number = (): number => fakeNowInMs;

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			// tokenExpirationInS=0 -> deadline == now at bootstrap -> scheduleRefresh sees remaining <= 0 and stops.
			const provider: OfflineTokenProvider = await login({
				...BASE_OPTIONS,
				fetchImpl: stub.fetchImpl,
				nowInMs,
				tokenExpirationInS: 0
			});
			assert.equal(provider.getAccessToken(), 'access-1');
			// The frozen clock makes remainingInMs EXACTLY 0 -- the single input separating `<= 0` from
			// `< 0` -- so the loop must have lapsed at schedule time with NO timer armed at all. A timer
			// armed here would fire straight into refresh()'s deadline check and leave the call count at 1.
			assert.equal(internalsOf(provider).timer, null, 'a lapsed bounded loop must not arm a refresh timer');

			// No timer was armed; advancing the clock must not trigger a refresh.
			fakeNowInMs += 100_000;
			mock.timers.tick(100_000);
			await flushMicrotasks();

			assert.equal(stub.calls.length, 1);
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('stop() is idempotent and keeps the last token readable', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });

		const armedTimer: unknown = internalsOf(provider).timer;
		assert.notEqual(armedTimer, null, 'bootstrap must have armed a refresh timer');

		const clearTimeoutSpy: ClearTimeoutSpy = spyOnClearTimeout();
		try {
			provider.stop();
			provider.stop();
			provider.stop();
		} finally {
			clearTimeoutSpy.restore();
		}

		// stop() must really CANCEL the armed timer -- and, being idempotent, cancel it exactly once...
		assert.equal(
			clearTimeoutSpy.cancelledHandles.length,
			1,
			'stop() did not cancel the armed refresh timer exactly once'
		);
		assert.strictEqual(clearTimeoutSpy.cancelledHandles[0], armedTimer, 'stop() cancelled a different timer handle');
		// ... and drop the handle, so nothing is left armed behind the `stopped` flag.
		assert.equal(internalsOf(provider).timer, null, 'stop() left a refresh timer handle behind');

		mock.timers.tick(100_000);
		await flushMicrotasks();

		assert.equal(stub.calls.length, 1);
		assert.equal(provider.getAccessToken(), 'access-1');
		assert.equal(provider.getAuthorizationHeader(), 'Bearer access-1');
	} finally {
		mock.timers.reset();
	}
});

runTestCase(
	'a refresh invoked after stop() returns immediately without touching the endpoint',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
			provider.stop();

			// stop() ends the loop, so a loop entered afterwards must return without a request.
			await internalsOf(provider).runRefreshLoop();

			assert.equal(stub.calls.length, 1);
			assert.equal(provider.getAccessToken(), 'access-1');
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('a browser-style numeric timer handle (no unref) is armed without calling unref', (): void => {
	const stub: FetchStub = makeFetchStub([]);
	const provider: OfflineTokenProvider = new OfflineTokenProvider({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
	const originalSetTimeout: typeof globalThis.setTimeout = globalThis.setTimeout;
	const browserTimerHandle: number = 4242;

	// A browser's setTimeout returns a plain number, which has no unref(). wait() arms its timer
	// synchronously, so the stub is only installed around the direct call -- no await inside the swap.
	globalThis.setTimeout = ((): number => browserTimerHandle) as unknown as typeof globalThis.setTimeout;
	try {
		void internalsOf(provider).wait(300);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}

	assert.equal(internalsOf(provider).timer, browserTimerHandle);
	assert.equal(stub.calls.length, 0);
	provider.stop();
});

runTestCase('login falls back to the global fetch when no fetchImpl is provided', async (): Promise<void> => {
	const calls: string[] = [];
	const originalFetch: typeof globalThis.fetch = globalThis.fetch;
	// Override the global fetch so the default-branch (`globalThis.fetch`) is exercised without network.
	globalThis.fetch = ((url: string): Promise<TokenFetchResponse> => {
		calls.push(url);
		return Promise.resolve({
			ok: true,
			status: 200,
			text: (): Promise<string> =>
				Promise.resolve(JSON.stringify({ access_token: 'global-1', refresh_token: 'offline-1', expires_in: 31 }))
		});
	}) as unknown as typeof globalThis.fetch;

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS });
		assert.equal(calls.length, 1);
		assert.equal(calls[0], EXPECTED_TOKEN_ENDPOINT);
		assert.equal(provider.getAccessToken(), 'global-1');
		provider.stop();
	} finally {
		globalThis.fetch = originalFetch;
		mock.timers.reset();
	}
});

runTestCase(
	'verifySsl omitted (default) => the default transport attaches NO undici dispatcher (TLS verification ON)',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);
		const originalFetch: typeof globalThis.fetch = globalThis.fetch;
		// Install the capturing stub as the global fetch so the DEFAULT transport (no fetchImpl) is exercised.
		globalThis.fetch = stub.fetchImpl as unknown as typeof globalThis.fetch;

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS });
			assert.equal(stub.calls.length, 1);
			// Secure default: verification ON => no insecure dispatcher on the wire.
			assert.equal(stub.calls[0].init.dispatcher, undefined);
			assert.equal(provider.getAccessToken(), 'access-1');
			provider.stop();
		} finally {
			globalThis.fetch = originalFetch;
			mock.timers.reset();
		}
	}
);

runTestCase(
	'keycloakVerifySsl:true (explicit) => the default transport attaches NO undici dispatcher (TLS verification ON)',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);
		const originalFetch: typeof globalThis.fetch = globalThis.fetch;
		globalThis.fetch = stub.fetchImpl as unknown as typeof globalThis.fetch;

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, keycloakVerifySsl: true });
			assert.equal(stub.calls.length, 1);
			assert.equal(stub.calls[0].init.dispatcher, undefined);
			provider.stop();
		} finally {
			globalThis.fetch = originalFetch;
			mock.timers.reset();
		}
	}
);

runTestCase(
	'keycloakVerifySsl:false => an insecure undici dispatcher is attached and the Agent is built once and cached',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } },
			{ body: { access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 } }
		]);
		const originalFetch: typeof globalThis.fetch = globalThis.fetch;
		globalThis.fetch = stub.fetchImpl as unknown as typeof globalThis.fetch;

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			// Two independent logins -> two independent default transports -> two dispatcher lookups.
			const firstProvider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, keycloakVerifySsl: false });
			const secondProvider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, keycloakVerifySsl: false });
			assert.equal(stub.calls.length, 2);

			const firstDispatcher: unknown = stub.calls[0].init.dispatcher;
			const secondDispatcher: unknown = stub.calls[1].init.dispatcher;
			// verify OFF under Node => a dispatcher (undici Agent) is present on the request init...
			assert.notEqual(firstDispatcher, undefined);
			// ... it is an undici Agent instance (constructor name), proving the insecure path was taken...
			assert.equal((firstDispatcher as { constructor: { name: string } }).constructor.name, 'Agent');
			// ... and -- the whole point of the flag, and NOT implied by the constructor name, since a
			// certificate-verifying Agent is an `Agent` too -- that Agent really does skip TLS verification.
			assert.equal(
				readRejectUnauthorized(firstDispatcher),
				false,
				'the insecure undici Agent must be built with connect.rejectUnauthorized === false'
			);
			// ... and the module-level cache hands out the very SAME Agent instance to every caller.
			assert.strictEqual(firstDispatcher, secondDispatcher, 'the insecure undici Agent must be built once and cached');

			assert.equal(firstProvider.getAccessToken(), 'access-1');
			assert.equal(secondProvider.getAccessToken(), 'access-2');
			firstProvider.stop();
			secondProvider.stop();
		} finally {
			globalThis.fetch = originalFetch;
			mock.timers.reset();
		}
	}
);

runTestCase(
	'the default transport skips the undici dispatcher when there is no Node process (browser bundle)',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);
		const transport: TokenFetch = createDefaultTokenFetch(false);
		const originalFetch: typeof globalThis.fetch = globalThis.fetch;
		globalThis.fetch = stub.fetchImpl as unknown as typeof globalThis.fetch;

		// `process` must be absent ONLY for the synchronous prefix (the browser guard). The transport
		// reads `globalThis.fetch` AFTER its await, so the stub stays installed until the promise settles.
		const pending: Promise<TokenFetchResponse> = withoutNodeProcess((): Promise<TokenFetchResponse> =>
			transport(EXPECTED_TOKEN_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
				body: 'grant_type=password'
			})
		);
		try {
			await pending;
		} finally {
			globalThis.fetch = originalFetch;
		}

		assert.equal(stub.calls.length, 1);
		// No Node process => the insecure dispatcher is a hard no-op (the browser owns TLS).
		assert.equal(stub.calls[0].init.dispatcher, undefined);
	}
);

runTestCase(
	'keycloakVerifySsl:false is IGNORED for an injected fetchImpl (no dispatcher added; existing behavior preserved)',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			// Custom transport injected: the flag must not touch its init (Python parity: flag ignored).
			const provider: OfflineTokenProvider = await login({
				...BASE_OPTIONS,
				keycloakVerifySsl: false,
				fetchImpl: stub.fetchImpl
			});
			assert.equal(stub.calls.length, 1);
			assert.equal(stub.calls[0].init.dispatcher, undefined);
			assert.equal(provider.getAccessToken(), 'access-1');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('stop() during an in-flight refresh suppresses re-arming the next refresh', async (): Promise<void> => {
	const calls: URLSearchParams[] = [];
	// Captures the refresh resolver so the test can complete the in-flight refresh on demand.
	let releaseRefresh: () => void = (): void => {};
	const fetchImpl: TokenFetch = (_url: string, init: TokenFetchInit): Promise<TokenFetchResponse> => {
		calls.push(new URLSearchParams(init.body));
		if (calls.length === 1) {
			return Promise.resolve({
				ok: true,
				status: 200,
				text: (): Promise<string> =>
					Promise.resolve(JSON.stringify({ access_token: 'access-1', refresh_token: 'offline-1', expires_in: 31 }))
			});
		}
		// Hold the refresh response open until the test releases it, after calling stop().
		return new Promise((resolve: (value: TokenFetchResponse) => void): void => {
			releaseRefresh = (): void => {
				resolve({
					ok: true,
					status: 200,
					text: (): Promise<string> =>
						Promise.resolve(JSON.stringify({ access_token: 'access-2', refresh_token: 'offline-2', expires_in: 31 }))
				});
			};
		});
	};

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl });

		// Fire the timer so refresh() starts and is parked awaiting the (pending) refresh response.
		mock.timers.tick(1000);
		await flushMicrotasks();
		assert.equal(calls.length, 2);

		// Stop while the refresh is in flight, then let it complete.
		provider.stop();
		releaseRefresh();
		await flushMicrotasks();
		await flushMicrotasks();

		// The completed refresh still updated the token, but scheduleRefresh saw `stopped` and armed nothing.
		assert.equal(provider.getAccessToken(), 'access-2');
		// Asserted DIRECTLY on the handle: a re-armed timer would fire into refresh()'s own `stopped`
		// guard and stay invisible to the fetch-call count below.
		assert.equal(internalsOf(provider).timer, null, 'the refresh completing after stop() re-armed the loop');
		mock.timers.tick(100_000);
		await flushMicrotasks();
		assert.equal(calls.length, 2);
	} finally {
		mock.timers.reset();
	}
});

// ---------------------------------------------------------------------------------------------
// The RETRY CADENCE of the failure path, which 7.1.2 added on top of 7.1.1's re-arm.
//
// 7.1.1 re-armed via scheduleRefresh(undefined), falling back to MIN_REFRESH_DELAY_IN_S -- a 1 s
// retry, i.e. one token request per second for the whole of an outage, in lockstep across every
// client that failed at the same moment. ondewo runs one client per call container, so that is an
// amplifier against a realm they all share rather than a bounded floor.
// ---------------------------------------------------------------------------------------------

runTestCase('consecutive failures back off exponentially and stop growing at the ceiling', async (): Promise<void> => {
	const responses: StubResponse[] = [{ body: { access_token: 'a', refresh_token: 'r', expires_in: 31 } }];
	for (let index: number = 0; index < 9; index += 1) {
		responses.push({ status: 503, body: 'down' });
	}
	const stub: FetchStub = makeFetchStub(responses);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		// randomFraction 1 puts every retry at the TOP of its window, i.e. exactly the ceiling for
		// that failure count -- which is what makes the ladder observable.
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			fetchImpl: stub.fetchImpl,
			randomFraction: (): number => 1
		});

		mock.timers.tick(1000);
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 2);

		const expectedDelaysInS: number[] = [5, 10, 20, 40, 80, 160, 300, 300];
		let attempt: number = 2;
		for (const delayInS of expectedDelaysInS) {
			mock.timers.tick(delayInS * 1000 - 1);
			await flushMicrotasks();
			assert.equal(stub.calls.length, attempt, `a retry fired early at the ${delayInS}s step`);

			mock.timers.tick(1);
			await flushMicrotasks();
			await flushMicrotasks();
			attempt += 1;
			assert.equal(stub.calls.length, attempt, `no retry fired at the ${delayInS}s step`);
		}
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase(
	'the retry delay is drawn from the jitter window rather than pinned to its edge',
	async (): Promise<void> => {
		const stub: FetchStub = makeFetchStub([
			{ body: { access_token: 'a', refresh_token: 'r', expires_in: 31 } },
			{ status: 503, body: 'down' },
			{ status: 503, body: 'down' },
			{ body: { access_token: 'b', refresh_token: 'r2', expires_in: 31 } }
		]);

		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			const provider: OfflineTokenProvider = await login({
				...BASE_OPTIONS,
				fetchImpl: stub.fetchImpl,
				randomFraction: (): number => 0.5
			});

			mock.timers.tick(1000);
			await flushMicrotasks();
			await flushMicrotasks();
			assert.equal(stub.calls.length, 2);

			// Failure 1: window [5, 5] -> 5 s regardless of the fraction.
			mock.timers.tick(5000);
			await flushMicrotasks();
			await flushMicrotasks();
			assert.equal(stub.calls.length, 3);

			// Failure 2: window [5, 10], fraction 0.5 -> 7.5 s. Neither edge of the window.
			mock.timers.tick(7499);
			await flushMicrotasks();
			assert.equal(stub.calls.length, 3, 'the jittered retry fired before its drawn delay');
			mock.timers.tick(1);
			await flushMicrotasks();
			await flushMicrotasks();
			assert.equal(stub.calls.length, 4, 'the jittered retry did not fire at its drawn delay');
			provider.stop();
		} finally {
			mock.timers.reset();
		}
	}
);

runTestCase('a successful refresh resets the backoff ladder', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'a', refresh_token: 'r', expires_in: 31 } },
		{ status: 503, body: 'down' },
		{ status: 503, body: 'down' },
		{ body: { access_token: 'b', refresh_token: 'r2', expires_in: 31 } },
		{ status: 503, body: 'down' },
		{ body: { access_token: 'c', refresh_token: 'r3', expires_in: 31 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			fetchImpl: stub.fetchImpl,
			randomFraction: (): number => 1
		});

		mock.timers.tick(1000);
		await flushMicrotasks();
		await flushMicrotasks();
		mock.timers.tick(5000); // failure 1 -> 5 s
		await flushMicrotasks();
		await flushMicrotasks();
		mock.timers.tick(10000); // failure 2 -> 10 s, and this attempt SUCCEEDS
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 4);
		assert.equal(provider.getAccessToken(), 'b');

		// Back on the success schedule: expires_in 31 - skew 30 = 1 s.
		mock.timers.tick(1000);
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 5, 'the success path should re-arm on the token lifetime');

		// That attempt failed again -- and because the ladder was reset it must wait 5 s, not 20 s.
		mock.timers.tick(4999);
		await flushMicrotasks();
		assert.equal(stub.calls.length, 5);
		mock.timers.tick(1);
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 6, 'a success must reset the backoff to its base');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase('a throwing onRefreshError handler still leaves the loop armed', async (): Promise<void> => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'a', refresh_token: 'r', expires_in: 31 } },
		{ status: 503, body: 'down' },
		{ body: { access_token: 'b', refresh_token: 'r2', expires_in: 31 } }
	]);

	mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	try {
		const provider: OfflineTokenProvider = await login({
			...BASE_OPTIONS,
			fetchImpl: stub.fetchImpl,
			randomFraction: (): number => 0
		});
		provider.onRefreshError((): void => {
			throw new Error('a diagnostics handler that misbehaves');
		});

		mock.timers.tick(1000);
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 2);

		// The handler's own error is contained and the re-arm runs unconditionally, so a throwing
		// handler neither ends the loop nor escapes as a process-fatal unhandledRejection.
		mock.timers.tick(5000);
		await flushMicrotasks();
		await flushMicrotasks();
		assert.equal(stub.calls.length, 3, 'a throwing error handler must not kill the refresh loop');
		assert.equal(provider.getAccessToken(), 'b');
		provider.stop();
	} finally {
		mock.timers.reset();
	}
});

runTestCase('logging the provider never prints a token: toJSON, util.inspect and console.log redact both', async () => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'secret-access-token', refresh_token: 'secret-offline-token', expires_in: 300 } }
	]);
	const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
	try {
		const renderings: string[] = [
			JSON.stringify(provider),
			JSON.stringify({ nested: { provider } }),
			inspect(provider),
			inspect({ nested: { provider } }, { depth: 5 }),
			format(provider)
		];
		for (const rendered of renderings) {
			assert.ok(!rendered.includes('secret-access-token'), rendered);
			assert.ok(!rendered.includes('secret-offline-token'), rendered);
			assert.ok(!rendered.includes(BASE_OPTIONS.password), rendered);
			assert.ok(rendered.includes('***REDACTED***'), rendered);
			assert.ok(rendered.includes(EXPECTED_TOKEN_ENDPOINT), rendered);
		}
		assert.deepEqual(JSON.parse(JSON.stringify(provider)), {
			tokenEndpoint: EXPECTED_TOKEN_ENDPOINT,
			clientId: BASE_OPTIONS.clientId,
			accessToken: '***REDACTED***',
			refreshToken: '***REDACTED***',
			stopped: false
		});
		// Only the logging view is redacted; the token itself is untouched.
		assert.equal(provider.getAuthorizationHeader(), 'Bearer secret-access-token');
	} finally {
		provider.stop();
	}
});

runTestCase('console.log of the provider prints the redacted view', async () => {
	const stub: FetchStub = makeFetchStub([
		{ body: { access_token: 'secret-access-token', refresh_token: 'secret-offline-token', expires_in: 300 } }
	]);
	const provider: OfflineTokenProvider = await login({ ...BASE_OPTIONS, fetchImpl: stub.fetchImpl });
	const written: string[] = [];
	const write: ReturnType<typeof mock.method> = mock.method(process.stdout, 'write', (chunk: string): boolean => {
		written.push(String(chunk));
		return true;
	});
	try {
		console.log(provider);
	} finally {
		write.mock.restore();
		provider.stop();
	}
	const output: string = written.join('');
	assert.ok(output.includes('***REDACTED***'), output);
	assert.ok(!output.includes('secret-access-token'), output);
	assert.ok(!output.includes('secret-offline-token'), output);
});

runTestCase('an absent or empty token renders as is, not as ***REDACTED***', () => {
	const provider: OfflineTokenProvider = new OfflineTokenProvider({ ...BASE_OPTIONS });
	assert.equal(provider.toJSON().accessToken, null);
	assert.equal(provider.toJSON().refreshToken, null);
	const tokens: { accessToken: string | null; refreshToken: string | null } = provider as unknown as {
		accessToken: string | null;
		refreshToken: string | null;
	};
	tokens.accessToken = '';
	tokens.refreshToken = '';
	assert.equal(provider.toJSON().accessToken, '');
	assert.equal(provider.toJSON().refreshToken, '');
	assert.match(inspect(provider), /accessToken: ''/);
});
