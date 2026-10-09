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
 * Tests for the gRPC-web endpoint / TLS helper: URL scheme and IPv6 bracketing, input validation, the
 * refusal of CA / client certificate / private key fields, the insecure-channel warning, that no error
 * message renders a PEM, and -- through the real `grpc-web` runtime with a recording `XMLHttpRequest` --
 * that a client built from the helper's output really sends to the https URL with `withCredentials`.
 *
 * @module
 */

import { test as runTestCase, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GrpcWebClientBase, MethodDescriptor, MethodType } from 'grpc-web';

import {
	createGrpcWebEndpoint,
	hostAndPort,
	REFUSED_TLS_FIELDS,
	type GrpcWebEndpoint,
	type GrpcWebEndpointConfig,
	type GrpcWebEndpointLogger
} from './grpcWebEndpoint';
import * as authBarrel from './offlineTokenProvider';

/** A PEM-shaped secret; no error message may ever contain any part of it. */
const FAKE_PEM: string = [
	'-----BEGIN',
	'PRIVATE KEY-----\r\nTOP-SECRET-KEY-MATERIAL\r\n-----END',
	'PRIVATE KEY-----\r\n'
].join(' ');

/** A logger that records every warning. */
interface RecordingLogger extends GrpcWebEndpointLogger {
	/** The warnings written so far. */
	readonly warnings: string[];
}

/**
 * Build a {@link RecordingLogger}.
 *
 * @returns A fresh logger with no warnings.
 */
function recordingLogger(): RecordingLogger {
	const warnings: string[] = [];
	return {
		warnings,
		warn: (message: string): void => {
			warnings.push(message);
		}
	};
}

/**
 * Call {@link createGrpcWebEndpoint} with a config that is not a valid {@link GrpcWebEndpointConfig} type
 * (what a JavaScript caller or a config ported from another SDK can pass) and return the thrown error.
 *
 * @param config - The untyped config.
 * @param logger - The logger to use.
 * @returns The thrown error.
 */
function errorFor(config: Record<string, unknown>, logger: GrpcWebEndpointLogger = recordingLogger()): Error {
	try {
		createGrpcWebEndpoint(config as unknown as GrpcWebEndpointConfig, logger);
	} catch (error: unknown) {
		assert.ok(error instanceof Error);
		return error;
	}
	assert.fail('createGrpcWebEndpoint did not throw');
}

runTestCase('a secure channel is the default and builds an https URL without warning', () => {
	const logger: RecordingLogger = recordingLogger();
	const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint({ host: 'nlu.example.com', port: 443 }, logger);
	assert.deepEqual(endpoint, { hostname: 'https://nlu.example.com:443', options: { withCredentials: false } });
	assert.deepEqual(logger.warnings, []);
});

runTestCase('useSecureChannel=true and a numeric string port build the same https URL', () => {
	const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint(
		{ host: '10.0.0.5', port: '50053', useSecureChannel: true },
		recordingLogger()
	);
	assert.equal(endpoint.hostname, 'https://10.0.0.5:50053');
});

runTestCase('withCredentials=true is passed on as the gRPC-web client option', () => {
	const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint({
		host: 'nlu.example.com',
		port: 443,
		withCredentials: true
	});
	assert.deepEqual(endpoint.options, { withCredentials: true });
});

runTestCase('an insecure channel builds an http URL and warns once, naming host:port', () => {
	const logger: RecordingLogger = recordingLogger();
	const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint(
		{ host: 'localhost', port: 50053, useSecureChannel: false },
		logger
	);
	assert.equal(endpoint.hostname, 'http://localhost:50053');
	assert.equal(logger.warnings.length, 1);
	assert.match(logger.warnings[0], /localhost:50053/);
	assert.match(logger.warnings[0], /NOT encrypted/);
});

runTestCase('the insecure-channel warning goes to the global console by default', () => {
	const warn: ReturnType<typeof mock.method> = mock.method(console, 'warn', (): void => undefined);
	try {
		createGrpcWebEndpoint({ host: '::1', port: 8080, useSecureChannel: false });
		assert.equal(warn.mock.callCount(), 1);
		assert.match(String(warn.mock.calls[0].arguments[0]), /\[::1\]:8080/);
	} finally {
		warn.mock.restore();
	}
});

runTestCase('IPv6 literals are bracketed; bracketed literals, names and IPv4 are left alone', () => {
	const cases: [string, string][] = [
		['::1', '[::1]:50051'],
		['2001:db8::7', '[2001:db8::7]:50051'],
		['::ffff:127.0.0.1', '[::ffff:127.0.0.1]:50051'],
		['[::1]', '[::1]:50051'],
		['127.0.0.1', '127.0.0.1:50051'],
		['nlu.example.com', 'nlu.example.com:50051']
	];
	for (const [host, expected] of cases) {
		assert.equal(hostAndPort(host, 50051), expected, host);
		assert.equal(createGrpcWebEndpoint({ host, port: 50051 }).hostname, `https://${expected}`, host);
	}
});

runTestCase('a host carrying a port is refused', () => {
	assert.match(errorFor({ host: 'localhost:50051', port: 50051 }).message, /host must not contain a port/);
	assert.throws(() => hostAndPort('localhost:50051', 50051), /host must not contain a port/);
});

runTestCase('a host carrying a scheme, credentials or path is refused without echoing it', () => {
	for (const host of ['https://nlu.example.com', 'user:hunter2@nlu.example.com', 'nlu.example.com/grpc']) {
		const message: string = errorFor({ host, port: 443 }).message;
		assert.match(message, /GrpcWebEndpointConfig\.host must be a bare host name/, host);
		assert.ok(!message.includes('hunter2'), host);
		assert.ok(!message.includes('nlu.example.com'), host);
	}
});

runTestCase('an empty, padded or non-string host is refused', () => {
	for (const host of ['', '   ', ' localhost', undefined, null, 42]) {
		assert.match(
			errorFor({ host, port: 443 }).message,
			/GrpcWebEndpointConfig\.host must be a non-empty/,
			String(host)
		);
	}
});

runTestCase('a port outside 1-65535 or not an integer is refused', () => {
	for (const port of [0, 65536, -1, 1.5, Number.NaN, '', '80a', '080000', ' 80', undefined, null, true]) {
		assert.match(
			errorFor({ host: 'localhost', port }).message,
			/GrpcWebEndpointConfig\.port must be an integer between 1 and 65535/,
			String(port)
		);
	}
	assert.equal(createGrpcWebEndpoint({ host: 'localhost', port: '65535' }).hostname, 'https://localhost:65535');
	assert.equal(createGrpcWebEndpoint({ host: 'localhost', port: 1 }).hostname, 'https://localhost:1');
});

runTestCase('a non-boolean useSecureChannel (e.g. the env string "false") is refused, not read as truthy', () => {
	assert.match(
		errorFor({ host: 'localhost', port: 80, useSecureChannel: 'false' }).message,
		/useSecureChannel must be a boolean/
	);
});

runTestCase('a non-boolean withCredentials is refused', () => {
	assert.match(
		errorFor({ host: 'localhost', port: 80, withCredentials: 'true' }).message,
		/withCredentials must be a boolean/
	);
});

runTestCase('REFUSED_TLS_FIELDS covers the CA, client certificate and key in both spellings', () => {
	assert.deepEqual(Object.keys(REFUSED_TLS_FIELDS).sort(), [
		'grpcCert',
		'grpcClientCert',
		'grpcClientKey',
		'grpc_cert',
		'grpc_client_cert',
		'grpc_client_key'
	]);
});

runTestCase('every CA / client certificate / key field is refused, naming the field and never the PEM', () => {
	for (const field of Object.keys(REFUSED_TLS_FIELDS)) {
		const message: string = errorFor({ host: 'localhost', port: 443, [field]: FAKE_PEM }).message;
		assert.ok(message.startsWith(`GrpcWebEndpointConfig.${field} is not supported`), field);
		assert.ok(!message.includes('TOP-SECRET'), field);
		assert.ok(!message.includes('BEGIN'), field);
	}
});

runTestCase('half a client pair (certificate only, key only) is refused', () => {
	assert.match(errorFor({ host: 'h', port: 443, grpcClientCert: FAKE_PEM }).message, /grpcClientCert is not supported/);
	assert.match(errorFor({ host: 'h', port: 443, grpcClientKey: FAKE_PEM }).message, /grpcClientKey is not supported/);
});

runTestCase('an insecure channel with a client identity is refused before any warning is logged', () => {
	const logger: RecordingLogger = recordingLogger();
	const error: Error = errorFor(
		{ host: 'localhost', port: 80, useSecureChannel: false, grpc_client_cert: FAKE_PEM, grpc_client_key: FAKE_PEM },
		logger
	);
	assert.match(error.message, /grpc_client_cert is not supported/);
	assert.deepEqual(logger.warnings, []);
});

runTestCase('empty, null or undefined TLS fields mean plain TLS (a ported config with blanks still works)', () => {
	for (const blank of ['', null, undefined]) {
		const config: Record<string, unknown> = { host: 'localhost', port: 443 };
		for (const field of Object.keys(REFUSED_TLS_FIELDS)) {
			config[field] = blank;
		}
		const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint(config as unknown as GrpcWebEndpointConfig);
		assert.equal(endpoint.hostname, 'https://localhost:443', String(blank));
	}
});

runTestCase('the endpoint carries only the URL and options, so logging it cannot leak a secret', () => {
	const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint({ host: 'localhost', port: 443 });
	assert.equal(JSON.stringify(endpoint), '{"hostname":"https://localhost:443","options":{"withCredentials":false}}');
});

runTestCase('the helper is re-exported through the auth module the package entry point re-exports', () => {
	assert.equal(authBarrel.createGrpcWebEndpoint, createGrpcWebEndpoint);
	assert.equal(authBarrel.hostAndPort, hostAndPort);
	assert.equal(authBarrel.REFUSED_TLS_FIELDS, REFUSED_TLS_FIELDS);
});

/** What the recording `XMLHttpRequest` saw of one request. */
interface SentRequest {
	/** The HTTP method. */
	method: string;
	/** The request URL. */
	url: string;
	/** The `withCredentials` flag at `send()` time. */
	withCredentials: boolean;
}

/**
 * Issue one unary call through the real `grpc-web` runtime, the way a generated client does
 * (`rpcCall(hostname + '/<service>/<method>', ...)`), with a recording `XMLHttpRequest` installed.
 *
 * @param endpoint - The endpoint built by {@link createGrpcWebEndpoint}.
 * @returns What the transport was asked to send.
 */
function sendThroughGrpcWeb(endpoint: GrpcWebEndpoint): SentRequest {
	const sent: SentRequest[] = [];
	/** Records `open` / `send`; never answers. */
	class RecordingXhr {
		public withCredentials: boolean = false;
		private method: string = '';
		private url: string = '';
		public open(method: string, url: string): void {
			this.method = method;
			this.url = url;
		}
		public setRequestHeader(): void {}
		public send(): void {
			sent.push({ method: this.method, url: this.url, withCredentials: this.withCredentials });
		}
		public abort(): void {}
	}
	const globals: Record<string, unknown> = globalThis;
	const previous: unknown = globals.XMLHttpRequest;
	globals.XMLHttpRequest = RecordingXhr;
	try {
		const client: GrpcWebClientBase = new GrpcWebClientBase(endpoint.options);
		const method: MethodDescriptor<object, object> = new MethodDescriptor(
			'/ondewo.example.Service/Get',
			MethodType.UNARY,
			Object,
			Object,
			(): Uint8Array => new Uint8Array(),
			(): object => ({})
		);
		client.rpcCall(`${endpoint.hostname}/ondewo.example.Service/Get`, {}, {}, method, (): void => undefined);
	} finally {
		globals.XMLHttpRequest = previous;
	}
	assert.equal(sent.length, 1);
	return sent[0];
}

runTestCase('grpc-web sends to the https URL with withCredentials when the helper says so', () => {
	const sent: SentRequest = sendThroughGrpcWeb(
		createGrpcWebEndpoint({ host: '::1', port: 8443, withCredentials: true })
	);
	assert.deepEqual(sent, {
		method: 'POST',
		url: 'https://[::1]:8443/ondewo.example.Service/Get',
		withCredentials: true
	});
});

runTestCase('grpc-web sends to the http URL without credentials for an insecure channel', () => {
	const sent: SentRequest = sendThroughGrpcWeb(
		createGrpcWebEndpoint({ host: 'localhost', port: 8080, useSecureChannel: false }, recordingLogger())
	);
	assert.deepEqual(sent, {
		method: 'POST',
		url: 'http://localhost:8080/ondewo.example.Service/Get',
		withCredentials: false
	});
});
