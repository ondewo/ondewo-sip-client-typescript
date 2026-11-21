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
 * The cross-SDK Keycloak token test catalogue (T01-T62), one test per id, plus the TypeScript edge cases.
 * Shared by every ONDEWO client SDK; the python SDK's `test_keycloak_refresh_resilience.py` and
 * `test_client_config_refresh_token.py` are the canonical originals.
 *
 * Every test uses a scripted fake transport (records every form), a fake monotonic clock starting at
 * 1000 s, a fixed jitter fraction and a scripted background-loop wait, so nothing touches the network
 * and nothing sleeps -- except T26 (a 50 ms transport delay) and T41 (the real timer and clock, with
 * shrunk timings).
 *
 * @module
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import type { StreamInterceptor, UnaryInterceptor } from 'grpc-web';

import {
	backoffDelayInS,
	clearKeycloakTokenProviderRegistry,
	createKeycloakAuthClientOptions,
	DEFAULT_KEYCLOAK_TOKEN_TIMINGS,
	getKeycloakTokenProvider,
	isKeycloakConfigured,
	KeycloakAuthenticationError,
	KeycloakAuthStreamInterceptor,
	KeycloakAuthUnaryInterceptor,
	keycloakTokenProviderRegistryKey,
	login,
	MAX_ERROR_BODY_CHARS,
	OfflineTokenProvider,
	redactLoginOptions,
	TokenError,
	type GrpcWebRequestLike,
	type KeycloakTokenLogger,
	type KeycloakTokenTimings,
	type OfflineTokenLoginOptions,
	type TokenFetch,
	type TokenFetchInit,
	type TokenFetchResponse
} from './offlineTokenProvider';

/** The clock every test starts at, in seconds. */
const START_IN_S: number = 1000;

/** Base credentials of every test. */
const BASE: OfflineTokenLoginOptions = {
	keycloakUrl: 'https://kc.example.com/auth',
	realm: 'ondewo-ccai-platform',
	clientId: 'ondewo-nlu-cai-sdk-public',
	username: 'tech-user@example.com',
	password: 'pw-1'
};

/** The token endpoint {@link BASE} resolves to. */
const TOKEN_URL: string = 'https://kc.example.com/auth/realms/ondewo-ccai-platform/protocol/openid-connect/token';

/** One scripted answer of the fake transport. */
interface Step {
	/** HTTP status (200 when omitted). */
	status?: number;
	/** Body: an object/array is JSON-encoded, a string is sent verbatim. */
	body?: unknown;
	/** When set, the transport rejects with this instead of answering. */
	error?: unknown;
	/** Seconds the fake clock advances while this request is "in flight". */
	advanceS?: number;
	/** Real milliseconds the answer is delayed (T26). */
	delayMs?: number;
}

/**
 * A successful token response.
 *
 * @param accessToken - The access token.
 * @param expiresIn - `expires_in`.
 * @param refreshToken - The refresh token (omitted from the body when `null`).
 * @returns The step.
 */
function ok(accessToken: string, expiresIn: unknown = 300, refreshToken: string | null = 'off-1'): Step {
	const body: Record<string, unknown> = { access_token: accessToken, expires_in: expiresIn };
	if (refreshToken !== null) {
		body.refresh_token = refreshToken;
	}
	return { body };
}

/** HTTP 400 for a dead offline session. */
const REFUSED: Step = {
	status: 400,
	body: { error: 'invalid_grant', error_description: 'Offline user session not found' }
};

/** HTTP 503 with a JSON body. */
const UNAVAILABLE: Step = { status: 503, body: { error: 'unavailable' } };

/** A fake monotonic clock in seconds. */
class FakeClock {
	/** Current time in seconds. */
	public now: number = START_IN_S;

	/**
	 * The `nowInMs` option.
	 *
	 * @returns The time in milliseconds.
	 */
	public readonly nowInMs: () => number = (): number => this.now * 1000;
}

/** The scripted fake transport. */
interface FakeTransport {
	/** The `fetchImpl` option. */
	fetchImpl: TokenFetch;
	/** Every request's form, in order. */
	forms: URLSearchParams[];
	/** Every request's URL. */
	urls: string[];
	/** Every request's init. */
	inits: TokenFetchInit[];
	/**
	 * The `grant_type` of every request.
	 *
	 * @returns The grant types in order.
	 */
	grants(): string[];
}

/**
 * Build a fake transport that answers `script` in order, then `fallback` for ever.
 *
 * @param clock - The clock to advance per step.
 * @param script - The answers.
 * @param fallback - The answer once `script` is exhausted (default: throw a bug error).
 * @returns The transport.
 */
function transport(clock: FakeClock, script: Step[], fallback?: Step): FakeTransport {
	const queue: Step[] = [...script];
	const forms: URLSearchParams[] = [];
	const urls: string[] = [];
	const inits: TokenFetchInit[] = [];
	const fetchImpl: TokenFetch = async (url: string, init: TokenFetchInit): Promise<TokenFetchResponse> => {
		forms.push(new URLSearchParams(init.body));
		urls.push(url);
		inits.push(init);
		const step: Step | undefined = queue.length > 0 ? queue.shift() : fallback;
		if (step === undefined) {
			throw new Error('transport script exhausted');
		}
		if (step.delayMs !== undefined) {
			await new Promise<void>((resolve: () => void): void => {
				setTimeout(resolve, step.delayMs);
			});
		}
		clock.now += step.advanceS !== undefined ? step.advanceS : 0;
		if (step.error !== undefined) {
			// eslint-disable-next-line @typescript-eslint/only-throw-error -- T09/T23 script non-Error rejections too
			throw step.error;
		}
		const status: number = step.status !== undefined ? step.status : 200;
		const text: string = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
		return { ok: status >= 200 && status < 300, status, text: (): Promise<string> => Promise.resolve(text) };
	};
	return {
		fetchImpl,
		forms,
		urls,
		inits,
		grants: (): string[] => forms.map((form: URLSearchParams): string => String(form.get('grant_type')))
	};
}

/** A logger that records every line with its level. */
interface RecordingLogger extends KeycloakTokenLogger {
	/** `WARNING <line>` / `INFO <line>` / `DEBUG <line>`, in order. */
	lines: string[];
}

/**
 * Build a recording logger.
 *
 * @returns The logger.
 */
function recordingLogger(): RecordingLogger {
	const lines: string[] = [];
	return {
		lines,
		warn: (message: string): void => {
			lines.push(`WARNING ${message}`);
		},
		info: (message: string): void => {
			lines.push(`INFO ${message}`);
		},
		debug: (message: string): void => {
			lines.push(`DEBUG ${message}`);
		}
	};
}

/** The scripted background-loop wait. */
interface FakeWait {
	/** The `waitImpl` option. */
	waitImpl: (delayInS: number) => Promise<boolean>;
	/** Every requested delay. */
	delays: number[];
}

/**
 * A wait that advances the clock by the delay and times out `timeouts` times, then ends the loop.
 *
 * @param clock - The clock to advance.
 * @param timeouts - How many waits time out (resolve `false`) before one resolves `true`.
 * @returns The wait.
 */
function fakeWait(clock: FakeClock, timeouts: number): FakeWait {
	const delays: number[] = [];
	let remaining: number = timeouts;
	return {
		delays,
		waitImpl: (delayInS: number): Promise<boolean> => {
			delays.push(delayInS);
			if (remaining <= 0) {
				return Promise.resolve(true);
			}
			remaining -= 1;
			clock.now += delayInS;
			return Promise.resolve(false);
		}
	};
}

/** The private members some tests read. */
interface Internals {
	/** Monotonic expiry of the current token. */
	expiresAtInS: number;
	/** Monotonic deadline of the refresh, or `null`. */
	deadlineInS: number | null;
	/** Consecutive failed refreshes. */
	consecutiveRefreshFailures: number;
	/** The running background loop. */
	loop: Promise<void> | null;
	/** Whether the loop has ended. */
	stopped: boolean;
	/**
	 * The background loop.
	 *
	 * @returns A promise resolving when it ends.
	 */
	runRefreshLoop(): Promise<void>;
	/**
	 * The default wait.
	 *
	 * @param delayInS - Seconds.
	 * @returns Resolves `false` after the delay.
	 */
	wait(delayInS: number): Promise<boolean>;
}

/**
 * View a provider's private members.
 *
 * @param provider - The provider.
 * @returns The same object, typed as {@link Internals}.
 */
function internals(provider: OfflineTokenProvider): Internals {
	return provider as unknown as Internals;
}

/** What {@link start} returns. */
interface Harness {
	/** The clock. */
	clock: FakeClock;
	/** The transport. */
	net: FakeTransport;
	/** The logger. */
	log: RecordingLogger;
	/** The provider. */
	provider: OfflineTokenProvider;
}

/** Options of {@link start}. */
interface StartOptions {
	/** The transport script (first step answers the start-up). */
	script: Step[];
	/** The answer once the script is exhausted. */
	fallback?: Step;
	/** Jitter fraction (default 0.5). */
	jitter?: number;
	/** Extra login options. */
	options?: Partial<OfflineTokenLoginOptions>;
}

/**
 * Log in with a fake clock, transport and logger, WITHOUT the background loop.
 *
 * @param settings - The script and overrides.
 * @returns The harness.
 */
async function start(settings: StartOptions): Promise<Harness> {
	const clock: FakeClock = new FakeClock();
	const net: FakeTransport = transport(clock, settings.script, settings.fallback);
	const log: RecordingLogger = recordingLogger();
	const jitter: number = settings.jitter !== undefined ? settings.jitter : 0.5;
	const provider: OfflineTokenProvider = await login({
		...BASE,
		fetchImpl: net.fetchImpl,
		nowInMs: clock.nowInMs,
		randomFraction: (): number => jitter,
		logger: log,
		startBackgroundRefresh: false,
		...settings.options
	});
	return { clock, net, log, provider };
}

/**
 * Run the background loop with a scripted wait until it ends.
 *
 * @param harness - The harness.
 * @param timeouts - Waits that time out before the loop is ended.
 * @returns The requested delays.
 */
async function runLoop(harness: Harness, timeouts: number): Promise<number[]> {
	const wait: FakeWait = fakeWait(harness.clock, timeouts);
	(harness.provider as unknown as { waitImpl: (delayInS: number) => Promise<boolean> }).waitImpl = wait.waitImpl;
	await internals(harness.provider).runRefreshLoop();
	return wait.delays;
}

/**
 * Read the bearer value through the lazy path.
 *
 * @param provider - The provider.
 * @returns The `authorization` metadata value.
 */
async function bearer(provider: OfflineTokenProvider): Promise<string> {
	return (await provider.getAuthorizationMetadata()).authorization;
}

/**
 * A validator for `assert.rejects` pinning a {@link TokenError} whose message matches.
 *
 * @param pattern - The message pattern.
 * @returns The validator.
 */
function tokenError(pattern: RegExp): (error: unknown) => boolean {
	return (error: unknown): boolean => {
		assert.ok(error instanceof KeycloakAuthenticationError, `expected a TokenError, got ${String(error)}`);
		assert.match(error.message, pattern);
		return true;
	};
}

/**
 * Create an error with a given `name`.
 *
 * @param name - The name.
 * @param message - The message.
 * @returns The error.
 */
function namedError(name: string, message: string): Error {
	const error: Error = new Error(message);
	error.name = name;
	return error;
}

/**
 * Create a Node system error (an `Error` with a `code`).
 *
 * @param code - The code, e.g. `ECONNREFUSED`.
 * @returns The error.
 */
function systemError(code: string): Error {
	return Object.assign(new Error(`connect ${code} 127.0.0.1:8443`), { code });
}

describe('A. backoff ladder', (): void => {
	it('T01 the ceiling doubles at fraction 1.0', (): void => {
		const ladder: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n: number): number => backoffDelayInS(n, () => 1));
		assert.deepEqual(ladder, [5, 10, 20, 40, 80, 160, 300, 300, 300, 300]);
	});

	it('T02 fraction 0.0 always waits the base', (): void => {
		for (let n: number = 1; n <= 19; n += 1) {
			assert.equal(
				backoffDelayInS(n, () => 0),
				5
			);
		}
	});

	it('T03 the delay is drawn inside the window', (): void => {
		assert.equal(
			backoffDelayInS(2, () => 0.5),
			7.5
		);
		assert.equal(
			backoffDelayInS(3, () => 0.25),
			8.75
		);
	});

	it('T04 a faulty jitter source is clamped', (): void => {
		for (const fraction of [-1, -0.001, 1.5, 1e9]) {
			const delay: number = backoffDelayInS(4, () => fraction);
			assert.ok(delay >= 5 && delay <= 40, `${fraction} -> ${delay}`);
		}
	});

	it('T05 n <= 0 behaves as n = 1', (): void => {
		assert.equal(
			backoffDelayInS(0, () => 1),
			5
		);
		assert.equal(
			backoffDelayInS(-3, () => 1),
			5
		);
	});

	it('T06 a huge n neither overflows nor exceeds the ceiling', (): void => {
		assert.equal(
			backoffDelayInS(1e9, () => 1),
			300
		);
		assert.equal(
			backoffDelayInS(Number.MAX_SAFE_INTEGER, () => 1),
			300
		);
	});

	it('T07 the production constants and their relations', (): void => {
		const timings: Readonly<KeycloakTokenTimings> = DEFAULT_KEYCLOAK_TOKEN_TIMINGS;
		assert.deepEqual(
			{ ...timings },
			{
				expiryLeewayInS: 30,
				minRefreshDelayInS: 1,
				retryBaseDelayInS: 5,
				retryMaxDelayInS: 300,
				maxRetryExponent: 6,
				httpTimeoutInS: 10,
				threadJoinTimeoutInS: 5
			}
		);
		assert.equal(MAX_ERROR_BODY_CHARS, 500);
		assert.ok(timings.retryBaseDelayInS > timings.minRefreshDelayInS);
		assert.ok(timings.retryBaseDelayInS * 2 ** timings.maxRetryExponent >= timings.retryMaxDelayInS);
		assert.ok(timings.httpTimeoutInS < timings.expiryLeewayInS);
		assert.ok(Object.isFrozen(timings));
	});
});

describe('B. the background loop survives every failure', (): void => {
	it('T08 refused, then success', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), REFUSED, ok('acc-3')] });
		await runLoop(harness, 2);
		assert.deepEqual(harness.net.grants(), ['password', 'refresh_token', 'refresh_token']);
		assert.equal(await bearer(harness.provider), 'Bearer acc-3');
		assert.equal(internals(harness.provider).consecutiveRefreshFailures, 0);
	});

	const failures: [string, Step][] = [
		['network error', { error: new TypeError('fetch failed') }],
		[
			'connection refused',
			{ error: Object.assign(new TypeError('fetch failed'), { cause: systemError('ECONNREFUSED') }) }
		],
		['a system error', { error: systemError('ECONNRESET') }],
		['timeout', { error: namedError('TimeoutError', 'The operation timed out') }],
		['abort', { error: namedError('AbortError', 'This operation was aborted') }],
		['a non-auth error thrown by the transport', { error: new RangeError('bug in the transport') }],
		['a thrown non-Error value', { error: 'a string' }],
		['HTTP 503 with a JSON body', UNAVAILABLE],
		['HTTP 502 with an empty body', { status: 502, body: '' }],
		['200 that is not JSON', { body: '<html>bad gateway</html>' }],
		['200 JSON array', { body: [1, 2] }],
		['200 without access_token', { body: { expires_in: 300 } }],
		['200 with expires_in "soon"', ok('acc-x', 'soon')]
	];
	for (const [label, failure] of failures) {
		it(`T09 ${label} does not end the loop`, async (): Promise<void> => {
			const harness: Harness = await start({ script: [ok('acc-1'), failure, ok('acc-ok')] });
			await runLoop(harness, 2);
			assert.equal(harness.net.forms.length, 3);
			assert.equal(await bearer(harness.provider), 'Bearer acc-ok');
		});
	}

	it('T10 a persistent failure keeps the loop alive and the token unchanged', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')], fallback: UNAVAILABLE });
		await runLoop(harness, 6);
		assert.deepEqual(harness.net.grants(), ['password', ...Array<string>(6).fill('refresh_token')]);
		assert.equal(harness.provider.getAccessToken(), 'acc-1');
		assert.equal(internals(harness.provider).consecutiveRefreshFailures, 6);
		// Once the token has expired the refresh raises inside the loop: logged at DEBUG, never a second WARNING.
		assert.equal(harness.log.lines.filter((line: string): boolean => line.startsWith('WARNING')).length, 6);
		assert.ok(harness.log.lines.some((line: string): boolean => line.startsWith('DEBUG Keycloak background')));
	});

	it('T11 never a password fallback', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1')],
			fallback: { status: 401, body: { error: 'invalid_client' } }
		});
		await runLoop(harness, 10);
		assert.equal(harness.net.grants().filter((grant: string): boolean => grant === 'password').length, 1);
		assert.equal(harness.net.forms.length, 11);
	});
});

describe('C. the background loop backs off', (): void => {
	it('T12 first wait 270 s, after one failure the base, not the floor', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE] });
		const delays: number[] = await runLoop(harness, 1);
		assert.deepEqual(delays, [270, 5]);
	});

	it('T13 the ladder doubles up to the ceiling', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')], fallback: UNAVAILABLE, jitter: 1 });
		const delays: number[] = await runLoop(harness, 9);
		assert.deepEqual(delays.slice(1, 10), [5, 10, 20, 40, 80, 160, 300, 300, 300]);
	});

	it('T14 a success resets the ladder and logs one recovery', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1'), UNAVAILABLE, UNAVAILABLE, ok('acc-4', 120), UNAVAILABLE],
			jitter: 1
		});
		const delays: number[] = await runLoop(harness, 5);
		assert.deepEqual(delays.slice(0, 5), [270, 5, 10, 90, 5]);
		const recoveries: string[] = harness.log.lines.filter((line: string): boolean => line.startsWith('INFO'));
		assert.deepEqual(recoveries, ['INFO Keycloak token refresh recovered after 2 failed attempt(s)']);
	});

	it('T15 the backoff is measured from when the failure is recorded', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), { ...UNAVAILABLE, advanceS: 10 }] });
		const delays: number[] = await runLoop(harness, 1);
		assert.deepEqual(delays, [270, 5]);
	});

	it('T16 the deadline ends the loop during the backoff', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const net: FakeTransport = transport(clock, [ok('acc-1', 30)], UNAVAILABLE);
		const wait: FakeWait = fakeWait(clock, 1000);
		const provider: OfflineTokenProvider = await login({
			...BASE,
			fetchImpl: net.fetchImpl,
			nowInMs: clock.nowInMs,
			randomFraction: (): number => 1,
			logger: recordingLogger(),
			tokenExpirationInS: 100,
			waitImpl: wait.waitImpl
		});
		await internals(provider).loop;
		assert.ok(clock.now <= START_IN_S + 100 + 1, String(clock.now));
		assert.equal(internals(provider).stopped, true);
		assert.ok(wait.delays.every((delay: number): boolean => delay <= 100));
		assert.equal(provider.toJSON().stopped, true);
	});

	it('T17 a stop during a backoff wait sends nothing more', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE] });
		const delays: number[] = await runLoop(harness, 1);
		assert.deepEqual(delays, [270, 5]);
		assert.deepEqual(harness.net.grants(), ['password', 'refresh_token']);
	});

	it('T17 stop() interrupts a pending wait', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		(harness.provider as unknown as { waitImpl: () => Promise<boolean> }).waitImpl = (): Promise<boolean> =>
			new Promise((): void => undefined);
		const loop: Promise<void> = internals(harness.provider).runRefreshLoop();
		harness.provider.stop();
		await loop;
		assert.deepEqual(harness.net.grants(), ['password']);
	});

	it('T17 a wait that elapses while stop() is called sends nothing', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		(harness.provider as unknown as { waitImpl: () => Promise<boolean> }).waitImpl = (): Promise<boolean> => {
			harness.provider.stop();
			return Promise.resolve(false);
		};
		await internals(harness.provider).runRefreshLoop();
		assert.deepEqual(harness.net.grants(), ['password']);
	});

	it('T18 a closed provider ends the loop without a request', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		harness.provider.stop();
		assert.deepEqual(await runLoop(harness, 5), []);
		assert.deepEqual(harness.net.grants(), ['password']);
	});
});

describe('D. the lazy path shares the backoff', (): void => {
	it('T19 a token inside the leeway is served when its refresh fails', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE] });
		harness.clock.now += 271;
		assert.equal(await bearer(harness.provider), 'Bearer acc-1');
		const warnings: string[] = harness.log.lines.filter((line: string): boolean => line.startsWith('WARNING'));
		assert.equal(warnings.length, 1);
		assert.match(
			warnings[0],
			/^WARNING Keycloak token refresh failed \(attempt 1\); retrying in 5\.0s, the current access token stays valid for 29\.0s \(TokenError: Keycloak token refresh failed with status 503: /
		);
	});

	it('T20 no request while the backoff runs', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE] });
		harness.clock.now += 275;
		for (let call: number = 0; call < 100; call += 1) {
			assert.equal(await bearer(harness.provider), 'Bearer acc-1');
			harness.clock.now += 0.04;
		}
		assert.deepEqual(harness.net.grants(), ['password', 'refresh_token']);
	});

	it('T21 an expired token during the backoff raises', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE], jitter: 1 });
		harness.clock.now += 299;
		assert.equal(await bearer(harness.provider), 'Bearer acc-1');
		harness.clock.now += 2;
		await assert.rejects(
			bearer(harness.provider),
			tokenError(
				/^The Keycloak access token has expired and the refresh is backing off after 1 consecutive failure\(s\); the next attempt is due in 3\.0s$/
			)
		);
		assert.equal(harness.net.forms.length, 2);
	});

	it('T22 an expired token whose refresh is refused raises', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), REFUSED] });
		harness.clock.now += 400;
		await assert.rejects(bearer(harness.provider), tokenError(/status 400: .*Offline user session not found/));
		assert.match(harness.log.lines[0], /the current access token has expired \(TokenError: /);
	});

	it('T23 a non-auth transport error is wrapped with its cause', async (): Promise<void> => {
		const bug: RangeError = new RangeError('bug in the transport');
		const harness: Harness = await start({ script: [ok('acc-1'), { error: bug }] });
		harness.clock.now += 400;
		await assert.rejects(bearer(harness.provider), (error: unknown): boolean => {
			assert.ok(error instanceof TokenError);
			assert.equal(error.message, 'Keycloak token refresh failed (RangeError: bug in the transport)');
			assert.equal(error.cause, bug);
			return true;
		});
	});

	it('T23 a thrown non-Error value is wrapped too', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), { error: 'boom' }] });
		harness.clock.now += 400;
		await assert.rejects(bearer(harness.provider), tokenError(/^Keycloak token refresh failed \(string: boom\)$/));
	});

	it('T24 the lazy path recovers after the backoff', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE, ok('acc-3')], jitter: 0 });
		harness.clock.now += 280;
		assert.equal(await bearer(harness.provider), 'Bearer acc-1');
		harness.clock.now += 5;
		assert.equal(await bearer(harness.provider), 'Bearer acc-3');
		assert.equal(internals(harness.provider).consecutiveRefreshFailures, 0);
		assert.ok(harness.log.lines.includes('INFO Keycloak token refresh recovered after 1 failed attempt(s)'));
	});

	it('T25 a lazy failure schedules the background loop', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE, ok('acc-3')], jitter: 1 });
		harness.clock.now += 280;
		await bearer(harness.provider);
		harness.clock.now += 2;
		const delays: number[] = await runLoop(harness, 1);
		assert.ok(Math.abs(delays[0] - 3) < 1e-6, String(delays[0]));
		assert.equal(harness.provider.getAccessToken(), 'acc-3');
	});

	it('T26 16 concurrent callers during an outage send ONE request', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1', 20)],
			fallback: { error: new TypeError('fetch failed'), delayMs: 50 }
		});
		const callers: Promise<string[]>[] = Array.from({ length: 16 }, async (): Promise<string[]> => {
			const perCaller: string[] = [];
			for (let call: number = 0; call < 20; call += 1) {
				perCaller.push(await bearer(harness.provider));
			}
			return perCaller;
		});
		const values: string[] = (await Promise.all(callers)).flat();
		assert.equal(values.length, 320);
		assert.ok(values.every((value: string): boolean => value === 'Bearer acc-1'));
		assert.deepEqual(harness.net.grants(), ['password', 'refresh_token']);
	});

	it('the lazy path before bootstrap raises and sends nothing', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const net: FakeTransport = transport(clock, []);
		const provider: OfflineTokenProvider = new OfflineTokenProvider({ ...BASE, fetchImpl: net.fetchImpl });
		await assert.rejects(provider.getAuthorizationMetadata(), tokenError(/^No access token available/));
		assert.equal(net.forms.length, 0);
	});
});

describe('E. response validation', (): void => {
	const unreachable: [string, unknown][] = [
		['network', new TypeError('fetch failed')],
		['connection refused', systemError('ECONNREFUSED')],
		['timeout', namedError('TimeoutError', 'timed out')],
		['abort', namedError('AbortError', 'aborted')]
	];
	for (const [label, failure] of unreachable) {
		it(`T27 ${label} at construction`, async (): Promise<void> => {
			await assert.rejects(start({ script: [{ error: failure }] }), (error: unknown): boolean => {
				assert.ok(error instanceof TokenError);
				assert.match(error.message, /^Keycloak token login could not reach the token endpoint \(/);
				assert.equal(error.cause, failure);
				return true;
			});
		});
	}

	it('T27 the 10 s timeout aborts a hanging request', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const hanging: TokenFetch = (url: string, init: TokenFetchInit): Promise<TokenFetchResponse> =>
			new Promise((resolve: (response: TokenFetchResponse) => void, reject: (reason: unknown) => void): void => {
				init.signal?.addEventListener('abort', (): void => {
					reject(init.signal?.reason as Error);
				});
			});
		mock.timers.enable({ apis: ['setTimeout'] });
		try {
			const pending: Promise<OfflineTokenProvider> = login({
				...BASE,
				fetchImpl: hanging,
				nowInMs: clock.nowInMs,
				startBackgroundRefresh: false
			});
			mock.timers.tick(9999);
			mock.timers.tick(1);
			await assert.rejects(
				pending,
				tokenError(
					/^Keycloak token login could not reach the token endpoint \(TimeoutError: the token endpoint did not answer within 10s\)$/
				)
			);
		} finally {
			mock.timers.reset();
		}
	});

	it('a non-transport error at construction propagates as is', async (): Promise<void> => {
		const bug: RangeError = new RangeError('bug');
		await assert.rejects(start({ script: [{ error: bug }] }), (error: unknown): boolean => error === bug);
	});

	it('T28 200 that is not JSON', async (): Promise<void> => {
		await assert.rejects(start({ script: [{ body: '<html>bad gateway</html>' }] }), (error: unknown): boolean => {
			assert.ok(error instanceof TokenError);
			assert.equal(error.message, 'Keycloak token login returned status 200 with a body that is not JSON');
			assert.ok(error.cause instanceof SyntaxError);
			return true;
		});
	});

	const nonObjects: [string, string][] = [
		['[1,2]', 'array'],
		['"text"', 'string'],
		['42', 'number'],
		['null', 'null'],
		['true', 'boolean']
	];
	for (const [body, type] of nonObjects) {
		it(`T29 200 JSON ${type}`, async (): Promise<void> => {
			await assert.rejects(
				start({ script: [{ body }] }),
				tokenError(new RegExp(`^Keycloak token login returned a JSON ${type} instead of an object$`))
			);
		});
	}

	it('T30 a 10 000-character error page is truncated', async (): Promise<void> => {
		await assert.rejects(start({ script: [{ status: 502, body: 'x'.repeat(10000) }] }), (error: unknown): boolean => {
			assert.ok(error instanceof TokenError);
			assert.ok(error.message.length < 500 + 200, String(error.message.length));
			assert.ok(error.message.endsWith('x'.repeat(500)));
			return true;
		});
	});

	it('T31 a response without access_token names fields, never values', async (): Promise<void> => {
		await assert.rejects(
			start({ script: [{ body: { refresh_token: 'secret-offline-token-77', expires_in: 300 } }] }),
			(error: unknown): boolean => {
				assert.ok(error instanceof TokenError);
				assert.match(error.message, /\[expires_in, refresh_token\]/);
				assert.ok(!error.message.includes('secret-offline-token-77'));
				return true;
			}
		);
	});

	it('T32 a non-numeric expires_in on refresh changes nothing', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), ok('acc-2', 'soon')] });
		harness.clock.now += 280;
		assert.equal(await bearer(harness.provider), 'Bearer acc-1');
		assert.equal(internals(harness.provider).expiresAtInS, 1300);
		assert.match(harness.log.lines[0], /non-numeric expires_in \(value withheld\)\)$/);
	});

	const unusableExpiresIn: unknown[] = [' ', null, 'NaN', 'Infinity', true, { seconds: 1 }];
	for (const expiresIn of unusableExpiresIn) {
		it(`an expires_in of ${JSON.stringify(expiresIn)} is refused`, async (): Promise<void> => {
			await assert.rejects(start({ script: [ok('acc-1', expiresIn)] }), tokenError(/non-numeric expires_in/));
		});
	}

	it('T33 a numeric string expires_in is accepted', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1', '300')] });
		assert.equal(internals(harness.provider).expiresAtInS, 1300);
	});

	it('an absent expires_in counts as 0', async (): Promise<void> => {
		const harness: Harness = await start({ script: [{ body: { access_token: 'acc-1', refresh_token: 'off-1' } }] });
		assert.equal(internals(harness.provider).expiresAtInS, 1000);
	});

	it('T34 a negative expires_in is already expired', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1', -50)] });
		assert.equal(internals(harness.provider).expiresAtInS, 1000);
	});

	it('T35 a refresh without a new refresh token keeps the previous one', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1', 300, 'off-1'), ok('acc-2', 300, null), ok('acc-3')] });
		harness.clock.now += 280;
		assert.equal(await bearer(harness.provider), 'Bearer acc-2');
		harness.clock.now += 280;
		assert.equal(await bearer(harness.provider), 'Bearer acc-3');
		assert.deepEqual(
			harness.net.forms.slice(1).map((form: URLSearchParams): string | null => form.get('refresh_token')),
			['off-1', 'off-1']
		);
	});

	it('T36 the grant forms, URL and timeout are exact', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1'), ok('acc-2')],
			options: { keycloakUrl: 'https://kc.example.com/auth/' }
		});
		harness.clock.now += 280;
		await bearer(harness.provider);
		const [passwordForm, refreshForm] = harness.net.forms;
		assert.deepEqual(Object.fromEntries(passwordForm), {
			grant_type: 'password',
			client_id: BASE.clientId,
			username: BASE.username,
			password: BASE.password,
			scope: 'offline_access'
		});
		assert.deepEqual(Object.fromEntries(refreshForm), {
			grant_type: 'refresh_token',
			client_id: BASE.clientId,
			refresh_token: 'off-1'
		});
		assert.deepEqual(harness.net.urls, [TOKEN_URL, TOKEN_URL]);
		assert.equal(harness.net.inits[0].method, 'POST');
		assert.equal(harness.net.inits[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
		assert.ok(harness.net.inits[0].signal !== undefined && !harness.net.inits[0].signal.aborted);
		assert.equal(DEFAULT_KEYCLOAK_TOKEN_TIMINGS.httpTimeoutInS, 10);
	});
});

describe('F. no credential in logs or errors', (): void => {
	it('T37 a fail-then-recover run logs no secret', async (): Promise<void> => {
		const secrets: string[] = ['pw-never-logged-5d1c', 'acc-secret-1', 'off-secret-1', 'acc-secret-2'];
		const errors: string[] = [];
		const harness: Harness = await start({
			script: [ok('acc-secret-1', 300, 'off-secret-1'), REFUSED, ok('acc-secret-2')],
			options: { password: 'pw-never-logged-5d1c' }
		});
		harness.provider.onRefreshError((error: unknown): void => {
			errors.push(String(error));
		});
		await runLoop(harness, 2);
		const log: string = harness.log.lines.join('\n');
		assert.match(log, /refresh failed \(attempt 1\)/);
		assert.match(log, /recovered/);
		const rendered: string = [
			log,
			...errors,
			JSON.stringify(harness.provider),
			inspect(harness.provider),
			JSON.stringify(redactLoginOptions({ ...BASE, password: 'pw-never-logged-5d1c', refreshToken: 'off-secret-1' }))
		].join('\n');
		for (const secret of secrets) {
			assert.ok(!rendered.includes(secret), secret);
		}
	});
});

describe('G. stop / close', (): void => {
	it('T38 stop twice on a provider without a loop', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		harness.provider.stop();
		harness.provider.stop();
		await harness.provider.close();
		assert.equal(harness.provider.toJSON().stopped, true);
		assert.equal(await bearer(harness.provider), 'Bearer acc-1', 'the lazy path still works after stop');
	});

	it('T39 stop from inside a refresh callback, then close', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), UNAVAILABLE] });
		harness.provider.onRefreshError((): void => {
			harness.provider.stop();
		});
		await runLoop(harness, 5);
		assert.deepEqual(harness.net.grants(), ['password', 'refresh_token']);
		await harness.provider.close();
		await harness.provider.close();
	});

	it('T40 close() returns when the loop does not finish in time', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		let release: () => void = (): void => undefined;
		const net: FakeTransport = transport(clock, [ok('acc-1', 0)]);
		const fetchImpl: TokenFetch = (url: string, init: TokenFetchInit): Promise<TokenFetchResponse> => {
			if (net.forms.length === 0) {
				return net.fetchImpl(url, init);
			}
			return new Promise((resolve: (response: TokenFetchResponse) => void): void => {
				release = (): void => {
					resolve({ ok: false, status: 503, text: (): Promise<string> => Promise.resolve('') });
				};
			});
		};
		const provider: OfflineTokenProvider = await login({
			...BASE,
			fetchImpl,
			nowInMs: clock.nowInMs,
			logger: recordingLogger(),
			timings: { threadJoinTimeoutInS: 0.02 },
			waitImpl: (): Promise<boolean> => Promise.resolve(false)
		});
		await new Promise<void>((resolve: () => void): void => {
			setImmediate(resolve);
		});
		const startedAt: number = performance.now();
		await provider.close();
		assert.ok(performance.now() - startedAt < 2000);
		release();
		await internals(provider).loop;
	});

	it('close() waits for a loop that ends in time', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const net: FakeTransport = transport(clock, [ok('acc-1')]);
		const provider: OfflineTokenProvider = await login({
			...BASE,
			fetchImpl: net.fetchImpl,
			nowInMs: clock.nowInMs,
			waitImpl: (): Promise<boolean> => new Promise((): void => undefined)
		});
		await provider.close();
		assert.equal(internals(provider).stopped, true);
	});
});

describe('H. the real loop end to end', (): void => {
	it('T41 survives three failures on the real timer and clock', async (): Promise<void> => {
		const net: FakeTransport = transport(new FakeClock(), [
			ok('acc-1', 0.1),
			{ error: new TypeError('fetch failed') },
			UNAVAILABLE,
			{ error: new RangeError('bug') },
			ok('acc-ok', 3600)
		]);
		const provider: OfflineTokenProvider = await login({
			...BASE,
			fetchImpl: net.fetchImpl,
			logger: recordingLogger(),
			timings: { expiryLeewayInS: 0.05, minRefreshDelayInS: 0.01, retryBaseDelayInS: 0.05, retryMaxDelayInS: 0.05 }
		});
		const deadline: number = performance.now() + 10000;
		while (provider.getAccessToken() !== 'acc-ok' && performance.now() < deadline) {
			await new Promise<void>((resolve: () => void): void => {
				setTimeout(resolve, 10);
			});
		}
		assert.equal(provider.getAccessToken(), 'acc-ok');
		assert.equal(internals(provider).stopped, false, 'the loop is still alive');
		assert.deepEqual(net.grants(), ['password', ...Array<string>(4).fill('refresh_token')]);
		await provider.close();
		let settled: boolean = false;
		void (internals(provider).loop as Promise<void>).then((): void => {
			settled = true;
		});
		await new Promise<void>((resolve: () => void): void => {
			setImmediate(resolve);
		});
		assert.equal(settled, true, 'the loop is no longer alive');
	});
});

describe('I. offline-token start-up', (): void => {
	it('T42 the start-up is one refresh grant with the handed-off token', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1')],
			options: { password: '', refreshToken: 'off-handed-0' }
		});
		assert.equal(harness.net.forms.length, 1);
		assert.deepEqual(Object.fromEntries(harness.net.forms[0]), {
			grant_type: 'refresh_token',
			client_id: BASE.clientId,
			refresh_token: 'off-handed-0'
		});
		assert.equal(harness.provider.getAuthorizationHeader(), 'Bearer acc-1');
	});

	it('T43 a password alongside the token is never sent', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1'), UNAVAILABLE, ok('acc-3')],
			options: { refreshToken: 'off-handed-0' },
			jitter: 0
		});
		harness.clock.now += 280;
		await bearer(harness.provider);
		harness.clock.now += 5;
		assert.equal(await bearer(harness.provider), 'Bearer acc-3');
		assert.ok(harness.net.grants().every((grant: string): boolean => grant === 'refresh_token'));
		assert.ok(harness.net.forms.every((form: URLSearchParams): boolean => !form.has('password')));
	});

	it('T44 a refused start-up token raises, without a password fallback', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const net: FakeTransport = transport(clock, [REFUSED]);
		await assert.rejects(
			login({ ...BASE, refreshToken: 'off-dead', fetchImpl: net.fetchImpl, nowInMs: clock.nowInMs }),
			tokenError(/^Keycloak token refresh failed with status 400: /)
		);
		assert.deepEqual(net.grants(), ['refresh_token']);
	});

	it('T45 a rotated token is used for the next refresh', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1', 300, 'off-rotated'), ok('acc-2')],
			options: { refreshToken: 'off-handed-0' }
		});
		harness.clock.now += 280;
		await bearer(harness.provider);
		assert.equal(harness.net.forms[1].get('refresh_token'), 'off-rotated');
	});

	it('the start-up keeps the handed-off token when the response has none', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1', 300, null), ok('acc-2')],
			options: { refreshToken: 'off-handed-0' }
		});
		harness.clock.now += 280;
		await bearer(harness.provider);
		assert.equal(harness.net.forms[1].get('refresh_token'), 'off-handed-0');
	});

	it('T46 the deadline is armed on the token path', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1')],
			fallback: ok('acc-n'),
			options: { refreshToken: 'off-handed-0', tokenExpirationInS: 200 }
		});
		assert.equal(internals(harness.provider).deadlineInS, 1200);
		await runLoop(harness, 1000);
		assert.ok(harness.clock.now <= 1201, String(harness.clock.now));
		assert.equal(internals(harness.provider).stopped, true);
		const sent: number = harness.net.forms.length;
		harness.clock.now += 1000;
		assert.equal(await bearer(harness.provider), `Bearer ${String(harness.provider.getAccessToken())}`);
		assert.equal(harness.net.forms.length, sent, 'past the deadline the lazy path sends nothing');
	});

	it('T47 the loop survives a failing offline token', async (): Promise<void> => {
		const harness: Harness = await start({
			script: [ok('acc-1'), REFUSED, REFUSED, ok('acc-4')],
			options: { refreshToken: 'off-handed-0' }
		});
		await runLoop(harness, 3);
		assert.deepEqual(harness.net.grants(), Array<string>(4).fill('refresh_token'));
		assert.equal(harness.provider.getAccessToken(), 'acc-4');
	});
});

/**
 * Registry options with a recording transport answering every login.
 *
 * @param overrides - Option overrides.
 * @returns The options and the transport.
 */
function registryOptions(overrides: Partial<OfflineTokenLoginOptions> = {}): [OfflineTokenLoginOptions, FakeTransport] {
	const clock: FakeClock = new FakeClock();
	const net: FakeTransport = transport(clock, [], ok('acc-1'));
	return [
		{ ...BASE, fetchImpl: net.fetchImpl, nowInMs: clock.nowInMs, startBackgroundRefresh: false, ...overrides },
		net
	];
}

describe('J. registry', (): void => {
	it('T48 the same credentials share one provider, created once', async (): Promise<void> => {
		const [options, net] = registryOptions();
		try {
			const [first, second] = await Promise.all([getKeycloakTokenProvider(options), getKeycloakTokenProvider(options)]);
			const third: OfflineTokenProvider | null = await getKeycloakTokenProvider({ ...options });
			assert.ok(first !== null && first === second && second === third);
			assert.equal(net.forms.length, 1);
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	it('T49 each different credential gets its own provider', async (): Promise<void> => {
		const [options] = registryOptions();
		try {
			const base: OfflineTokenProvider | null = await getKeycloakTokenProvider(options);
			const variants: Partial<OfflineTokenLoginOptions>[] = [
				{ username: 'other@example.com' },
				{ password: 'pw-2' },
				{ realm: 'other-realm' },
				{ keycloakUrl: 'https://other.example.com/auth' },
				{ clientId: 'other-client' },
				{ tokenExpirationInS: 60 },
				{ keycloakVerifySsl: false },
				{ refreshToken: 'off-x' }
			];
			const providers: (OfflineTokenProvider | null)[] = [base];
			for (const variant of variants) {
				providers.push(await getKeycloakTokenProvider({ ...options, ...variant }));
			}
			assert.equal(new Set(providers).size, variants.length + 1);
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	it('T50 50 configs with distinct usernames log in 50 times, in order', async (): Promise<void> => {
		const [options, net] = registryOptions();
		const usernames: string[] = Array.from({ length: 50 }, (unused: unknown, index: number): string => `user-${index}`);
		try {
			for (const username of usernames) {
				await getKeycloakTokenProvider({ ...options, username });
			}
			assert.deepEqual(
				net.forms.map((form: URLSearchParams): string | null => form.get('username')),
				usernames
			);
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	it('T51 two token-only tenants get different providers', async (): Promise<void> => {
		const [options, net] = registryOptions({ password: '' });
		try {
			const a: OfflineTokenProvider | null = await getKeycloakTokenProvider({
				...options,
				refreshToken: 'off-tenant-a'
			});
			const b: OfflineTokenProvider | null = await getKeycloakTokenProvider({
				...options,
				refreshToken: 'off-tenant-b'
			});
			assert.notEqual(a, b);
			assert.deepEqual(
				net.forms.map((form: URLSearchParams): string | null => form.get('refresh_token')),
				['off-tenant-a', 'off-tenant-b']
			);
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	it('T52/T53 the key holds no secret and is 64 hex characters', async (): Promise<void> => {
		const key: string = await keycloakTokenProviderRegistryKey({
			...BASE,
			password: 'pw-secret-key-1',
			refreshToken: 'off-secret-key-1',
			tokenExpirationInS: 60,
			keycloakVerifySsl: false
		});
		assert.match(key, /^[0-9a-f]{64}$/);
		assert.ok(!key.includes('pw-secret') && !key.includes('off-secret'));
		const tolerant: string = await keycloakTokenProviderRegistryKey({
			...BASE,
			password: undefined as unknown as string
		});
		assert.equal(tolerant, await keycloakTokenProviderRegistryKey({ ...BASE, password: '' }));
	});

	it('the key is the SHA-256 the python SDK derives', async (): Promise<void> => {
		// hashlib.sha256("\0".join([url, realm, client_id, user, pw, "", "True", ""]).encode()).hexdigest()
		const key: string = await keycloakTokenProviderRegistryKey(BASE);
		const expected: string = Buffer.from(
			await globalThis.crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(
					[BASE.keycloakUrl, BASE.realm, BASE.clientId, BASE.username, 'pw-1', '', 'True', ''].join('\0')
				)
			)
		).toString('hex');
		assert.equal(key, expected);
	});

	it('T54 a stopped provider is never handed out again', async (): Promise<void> => {
		const [options, net] = registryOptions();
		try {
			const first: OfflineTokenProvider | null = await getKeycloakTokenProvider(options);
			first?.stop();
			const [second, third] = await Promise.all([getKeycloakTokenProvider(options), getKeycloakTokenProvider(options)]);
			assert.ok(second !== null && second !== first && second === third);
			assert.equal(net.forms.length, 2);
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	it('a failed login is not cached', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const net: FakeTransport = transport(clock, [REFUSED, ok('acc-1')]);
		const options: OfflineTokenLoginOptions = { ...BASE, fetchImpl: net.fetchImpl, startBackgroundRefresh: false };
		try {
			await assert.rejects(getKeycloakTokenProvider(options), tokenError(/status 400/));
			const provider: OfflineTokenProvider | null = await getKeycloakTokenProvider(options);
			assert.equal(provider?.getAccessToken(), 'acc-1');
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	it('clearing the registry stops its providers and tolerates a failing login', async (): Promise<void> => {
		const clock: FakeClock = new FakeClock();
		const net: FakeTransport = transport(clock, [ok('acc-1'), { ...REFUSED, delayMs: 5 }]);
		const healthy: OfflineTokenProvider | null = await getKeycloakTokenProvider({ ...BASE, fetchImpl: net.fetchImpl });
		const failing: Promise<OfflineTokenProvider | null> = getKeycloakTokenProvider({
			...BASE,
			username: 'other',
			fetchImpl: net.fetchImpl
		});
		await new Promise<void>((resolve: () => void): void => {
			setTimeout(resolve, 1);
		});
		await clearKeycloakTokenProviderRegistry();
		await assert.rejects(failing, tokenError(/status 400/));
		assert.equal(healthy?.toJSON().stopped, true);
	});
});

describe('K. configuration', (): void => {
	it('T55 every surface takes ONE options object, so nothing positional can be rebound', (): void => {
		assert.equal(login.length, 1);
		assert.equal(OfflineTokenProvider.length, 1);
		assert.equal(getKeycloakTokenProvider.length, 1);
	});

	it('T56 a token-only config constructs and is Keycloak-configured', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')], options: { password: '', refreshToken: 'off-1' } });
		assert.equal(harness.provider.getAccessToken(), 'acc-1');
		assert.equal(isKeycloakConfigured({ ...BASE, password: '', refreshToken: 'off-1' }), true);
		const tolerant: Harness = await start({
			script: [ok('acc-1')],
			options: { password: undefined as unknown as string, refreshToken: 'off-1' }
		});
		assert.equal(tolerant.provider.getAccessToken(), 'acc-1');
	});

	it('T57 the Keycloak triple with neither password nor token is rejected', async (): Promise<void> => {
		const [options, net] = registryOptions({ password: '' });
		const pattern: RegExp = /"password".*"refreshToken".*refresh_token/;
		await assert.rejects(login(options), tokenError(pattern));
		await assert.rejects(login({ ...options, refreshToken: '' }), tokenError(pattern));
		await assert.rejects(getKeycloakTokenProvider(options), tokenError(pattern));
		assert.equal(net.forms.length, 0);
	});

	it('T58 a password config is unchanged', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		assert.deepEqual(harness.net.grants(), ['password']);
		assert.equal(isKeycloakConfigured(BASE), true);
	});

	it('T59 a rendering redacts both secrets and keeps an empty one empty', async (): Promise<void> => {
		const view: Record<string, unknown> = redactLoginOptions({
			...BASE,
			password: 'pw-secret-59',
			refreshToken: 'off-secret-59',
			fetchImpl: transport(new FakeClock(), []).fetchImpl
		});
		assert.equal(view.password, '***REDACTED***');
		assert.equal(view.refreshToken, '***REDACTED***');
		assert.equal(view.username, BASE.username);
		assert.ok(!('fetchImpl' in view));
		const empty: Record<string, unknown> = redactLoginOptions({ ...BASE, password: '' });
		assert.equal(empty.password, '');
		assert.equal(empty.refreshToken, '');
		assert.equal(redactLoginOptions({ ...BASE, password: undefined as unknown as string }).password, '');
		const harness: Harness = await start({ script: [ok('acc-1', 300, 'off-secret-59')] });
		assert.ok(!JSON.stringify(harness.provider).includes('off-secret-59'));
		const unstarted: OfflineTokenProvider = new OfflineTokenProvider({ ...BASE, refreshToken: 'off-secret-59' });
		assert.equal(unstarted.toJSON().refreshToken, '***REDACTED***');
	});

	it('T60 a token-only config reaches the provider with that token and no password', async (): Promise<void> => {
		const [options, net] = registryOptions({ password: '', refreshToken: 'off-handed-60' });
		try {
			await getKeycloakTokenProvider(options);
			assert.deepEqual(Object.fromEntries(net.forms[0]), {
				grant_type: 'refresh_token',
				client_id: BASE.clientId,
				refresh_token: 'off-handed-60'
			});
		} finally {
			await clearKeycloakTokenProviderRegistry();
		}
	});

	const triple: ('keycloakUrl' | 'realm' | 'clientId')[] = ['keycloakUrl', 'realm', 'clientId'];
	for (const missing of [
		['keycloakUrl'],
		['realm'],
		['clientId'],
		['keycloakUrl', 'realm'],
		['realm', 'clientId'],
		['keycloakUrl', 'clientId']
	]) {
		it(`T61 a partial Keycloak triple without ${missing.join(' and ')} is rejected`, async (): Promise<void> => {
			const [options, net] = registryOptions();
			const partial: OfflineTokenLoginOptions = { ...options };
			for (const key of missing) {
				partial[key as (typeof triple)[number]] = '';
			}
			await assert.rejects(
				getKeycloakTokenProvider(partial),
				tokenError(/the Keycloak fields "keycloakUrl", "realm", and "clientId" must be provided together/)
			);
			assert.equal(isKeycloakConfigured(partial), false);
			assert.equal(net.forms.length, 0);
		});
	}

	it('T62 no Keycloak triple builds no provider and sends nothing', async (): Promise<void> => {
		const [options, net] = registryOptions();
		assert.equal(await getKeycloakTokenProvider({ ...options, keycloakUrl: '', realm: '', clientId: '' }), null);
		assert.equal(net.forms.length, 0);
		assert.equal(isKeycloakConfigured({}), false);
	});

	it('a missing options object is rejected by the registry', async (): Promise<void> => {
		await assert.rejects(
			getKeycloakTokenProvider(undefined as unknown as OfflineTokenLoginOptions),
			tokenError(/^login\(\) requires an options object$/)
		);
	});

	it('the error carries its cause and keeps the TokenError name', (): void => {
		const cause: Error = new Error('inner');
		const error: TokenError = new KeycloakAuthenticationError('outer', cause);
		assert.equal(error.cause, cause);
		assert.equal(error.name, 'TokenError');
		assert.ok(error instanceof TokenError);
		assert.equal('cause' in new TokenError('no cause'), false);
	});
});

describe('interceptors', (): void => {
	/**
	 * A fake gRPC-web request.
	 *
	 * @returns The request and its metadata.
	 */
	function request(): [GrpcWebRequestLike, Record<string, string>] {
		const metadata: Record<string, string> = { 'x-existing': '1' };
		return [{ getMetadata: (): Record<string, string> => metadata }, metadata];
	}

	it('the unary interceptor attaches a token it refreshes on read', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), ok('acc-2')] });
		harness.clock.now += 280;
		const [call, metadata] = request();
		const result: string = await new KeycloakAuthUnaryInterceptor(harness.provider).intercept(
			call,
			(sent: GrpcWebRequestLike): Promise<string> => Promise.resolve(sent.getMetadata().authorization)
		);
		assert.equal(result, 'Bearer acc-2');
		assert.deepEqual(metadata, { 'x-existing': '1', authorization: 'Bearer acc-2' });
	});

	it('the unary interceptor sends no call with an expired token', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1'), REFUSED] });
		harness.clock.now += 400;
		let invoked: boolean = false;
		await assert.rejects(
			new KeycloakAuthUnaryInterceptor(harness.provider).intercept(request()[0], (): Promise<void> => {
				invoked = true;
				return Promise.resolve();
			}),
			tokenError(/status 400/)
		);
		assert.equal(invoked, false);
	});

	it('the stream interceptor attaches the current token', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		const [call, metadata] = request();
		const stream: string = new KeycloakAuthStreamInterceptor(harness.provider).intercept(call, (): string => 'stream');
		assert.equal(stream, 'stream');
		assert.equal(metadata.authorization, 'Bearer acc-1');
	});

	it('the client options plug into a generated gRPC-web client', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')] });
		const options: {
			unaryInterceptors: UnaryInterceptor<unknown, unknown>[];
			streamInterceptors: StreamInterceptor<unknown, unknown>[];
		} = createKeycloakAuthClientOptions(harness.provider);
		assert.ok(options.unaryInterceptors[0] instanceof KeycloakAuthUnaryInterceptor);
		assert.ok(options.streamInterceptors[0] instanceof KeycloakAuthStreamInterceptor);
	});
});

describe('defaults', (): void => {
	it('the default logger writes the WARNING and INFO lines to the console', async (): Promise<void> => {
		const warned: string[] = [];
		const informed: string[] = [];
		const warn: ReturnType<typeof mock.method> = mock.method(console, 'warn', (line: string): void => {
			warned.push(line);
		});
		const info: ReturnType<typeof mock.method> = mock.method(console, 'info', (line: string): void => {
			informed.push(line);
		});
		try {
			const clock: FakeClock = new FakeClock();
			const net: FakeTransport = transport(clock, [ok('acc-1'), UNAVAILABLE, ok('acc-2')]);
			const provider: OfflineTokenProvider = await login({
				...BASE,
				fetchImpl: net.fetchImpl,
				nowInMs: clock.nowInMs,
				randomFraction: (): number => 0,
				startBackgroundRefresh: false
			});
			clock.now += 280;
			await bearer(provider);
			clock.now += 5;
			await bearer(provider);
		} finally {
			warn.mock.restore();
			info.mock.restore();
		}
		assert.equal(warned.length, 1);
		assert.match(warned[0], /refresh failed \(attempt 1\)/);
		assert.deepEqual(informed, ['Keycloak token refresh recovered after 1 failed attempt(s)']);
	});

	it('the default clock is monotonic and the default jitter is used on failure', async (): Promise<void> => {
		const net: FakeTransport = transport(new FakeClock(), [ok('acc-1', 0, 'off-1'), UNAVAILABLE]);
		const provider: OfflineTokenProvider = await login({
			...BASE,
			fetchImpl: net.fetchImpl,
			logger: recordingLogger(),
			startBackgroundRefresh: false
		});
		await assert.rejects(bearer(provider), tokenError(/status 503/));
	});

	it('a delay above the timer limit is capped instead of firing at once', (): void => {
		const provider: OfflineTokenProvider = new OfflineTokenProvider(BASE);
		const delays: number[] = [];
		const setTimeoutMock: ReturnType<typeof mock.method> = mock.method(
			globalThis,
			'setTimeout',
			(handler: () => void, delay: number): number => {
				delays.push(delay);
				return 1;
			}
		);
		try {
			void internals(provider).wait(1e10);
		} finally {
			setTimeoutMock.mock.restore();
		}
		provider.stop();
		assert.deepEqual(delays, [2147483647]);
	});

	it('an empty handed-off token counts as none', async (): Promise<void> => {
		const harness: Harness = await start({ script: [ok('acc-1')], options: { refreshToken: '' } });
		assert.deepEqual(harness.net.grants(), ['password']);
	});
});
