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
 * gRPC-web endpoint helper: turns `host` / `port` / `useSecureChannel` into the `hostname` URL and the
 * client options every generated `*Client` / `*PromiseClient` constructor takes.
 *
 * TLS in a browser belongs to the browser: the server certificate is verified against the browser's /
 * operating system's trust store, and a client certificate (mutual TLS) can only come from the
 * browser's own certificate store. So this helper accepts no CA, no client certificate and no private
 * key -- a config carrying one (e.g. ported from the Python SDK's `grpc_cert` / `grpc_client_cert` /
 * `grpc_client_key`) is refused instead of silently dropped, and a private key never has to be shipped to
 * a browser. See the README section "TLS, mutual TLS and certificates".
 *
 * @packageDocumentation
 */

/** Connection settings of one gRPC-web (Envoy) endpoint. */
export interface GrpcWebEndpointConfig {
	/** Bare host name or IP address (IPv6 with or without brackets); no scheme, port or path. */
	host: string;
	/** TCP port, 1-65535. */
	port: number | string;
	/** `true` (the default) builds an `https://` URL; `false` builds a plaintext `http://` one and warns. */
	useSecureChannel?: boolean;
	/**
	 * Send credentials on cross-origin calls (gRPC-web's `withCredentials` client option, default
	 * `false`). Cookies, HTTP auth and the browser's TLS client certificate (mutual TLS) are only sent on
	 * a cross-origin request when this is `true`.
	 */
	withCredentials?: boolean;
}

/** The client options this helper sets; pass them as the third argument of a generated client. */
export interface GrpcWebClientOptions {
	/** gRPC-web's `withCredentials` option. */
	withCredentials: boolean;
}

/** What a generated gRPC-web client constructor takes: `new XClient(hostname, null, options)`. */
export interface GrpcWebEndpoint {
	/** `https://host:port` (or `http://` for an insecure channel); IPv6 hosts are bracketed. */
	readonly hostname: string;
	/** The gRPC-web client options. */
	readonly options: GrpcWebClientOptions;
}

/** Where the insecure-channel warning goes (the global `console` by default). */
export interface GrpcWebEndpointLogger {
	/**
	 * Write one warning.
	 *
	 * @param message - The warning text.
	 */
	warn(message: string): void;
}

/** Why a browser cannot use a CA certificate given in code. */
const CA_REASON: string =
	'a browser verifies the server certificate against its own trust store; install the CA there or use a publicly trusted certificate';
/** Why a browser cannot use a client certificate given in code. */
const CLIENT_CERT_REASON: string =
	'a browser presents a TLS client certificate only from its own certificate store; install the client certificate there';
/** Why a private key is refused. */
const CLIENT_KEY_REASON: string =
	'a private key must never be shipped to a browser; install the client certificate in its certificate store';

/**
 * Config fields of the other ONDEWO SDKs (camelCase and Python's snake_case) that a browser cannot use,
 * with the reason each is refused. A non-empty value for any of them raises; an empty one is ignored.
 */
export const REFUSED_TLS_FIELDS: Readonly<Record<string, string>> = {
	grpcCert: CA_REASON,
	grpc_cert: CA_REASON,
	grpcClientCert: CLIENT_CERT_REASON,
	grpc_client_cert: CLIENT_CERT_REASON,
	grpcClientKey: CLIENT_KEY_REASON,
	grpc_client_key: CLIENT_KEY_REASON
};

/** A bare IPv6 literal: hex groups, colons and an optional embedded IPv4 tail, at least two colons. */
const BARE_IPV6_PATTERN: RegExp = /^(?=(?:[^:]*:){2})[0-9A-Fa-f:.]+$/;

/**
 * Render `host:port` for a URL, bracketing a bare IPv6 literal (`::1` -> `[::1]:50051`).
 *
 * @param host - A bare host name, IPv4 address, or IPv6 address with or without brackets.
 * @param port - The port.
 * @returns `host:port`.
 * @throws {Error} When the host contains a colon but is neither a bracketed nor a bare IPv6 literal.
 */
export function hostAndPort(host: string, port: number | string): string {
	if (host.startsWith('[') && host.endsWith(']')) {
		return `${host}:${port}`;
	}
	if (BARE_IPV6_PATTERN.test(host)) {
		return `[${host}]:${port}`;
	}
	if (host.includes(':')) {
		throw new Error('GrpcWebEndpointConfig.host must not contain a port; pass the port in GrpcWebEndpointConfig.port');
	}
	return `${host}:${port}`;
}

/**
 * Validate a gRPC-web endpoint config and build the `hostname` URL and client options for a generated client.
 *
 * ```ts
 * const endpoint: GrpcWebEndpoint = createGrpcWebEndpoint({ host: 'nlu.example.com', port: 443 });
 * const agents: AgentsClient = new AgentsClient(endpoint.hostname, null, endpoint.options);
 * ```
 *
 * Error messages name the offending field only, never its value.
 *
 * @param config - Host, port and channel settings.
 * @param logger - Receives the warning for an insecure channel (default: the global `console`).
 * @returns The endpoint URL and the gRPC-web client options.
 * @throws {Error} When `host` / `port` / `useSecureChannel` / `withCredentials` is invalid, or the config
 *   carries a CA, client certificate or private key (see {@link REFUSED_TLS_FIELDS}).
 */
export function createGrpcWebEndpoint(
	config: GrpcWebEndpointConfig,
	logger: GrpcWebEndpointLogger = console
): GrpcWebEndpoint {
	const fields: Record<string, unknown> = config as unknown as Record<string, unknown>;
	for (const [name, reason] of Object.entries(REFUSED_TLS_FIELDS)) {
		const value: unknown = fields[name];
		if (value !== undefined && value !== null && value !== '') {
			throw new Error(`GrpcWebEndpointConfig.${name} is not supported by a gRPC-web client: ${reason}`);
		}
	}
	const host: unknown = config.host;
	if (typeof host !== 'string' || host.trim() === '' || host.trim() !== host) {
		throw new Error('GrpcWebEndpointConfig.host must be a non-empty host name or IP address without whitespace');
	}
	if (host.includes('/') || host.includes('@')) {
		throw new Error(
			'GrpcWebEndpointConfig.host must be a bare host name or IP address without scheme, credentials or path; ' +
				'the scheme comes from GrpcWebEndpointConfig.useSecureChannel'
		);
	}
	const port: unknown = config.port;
	let portNumber: number = Number.NaN;
	if (typeof port === 'number') {
		portNumber = port;
	} else if (typeof port === 'string' && /^[0-9]{1,5}$/.test(port)) {
		portNumber = Number(port);
	}
	if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
		throw new Error('GrpcWebEndpointConfig.port must be an integer between 1 and 65535');
	}
	const useSecureChannel: unknown = config.useSecureChannel ?? true;
	if (typeof useSecureChannel !== 'boolean') {
		throw new Error('GrpcWebEndpointConfig.useSecureChannel must be a boolean');
	}
	const withCredentials: unknown = config.withCredentials ?? false;
	if (typeof withCredentials !== 'boolean') {
		throw new Error('GrpcWebEndpointConfig.withCredentials must be a boolean');
	}
	const target: string = hostAndPort(host, portNumber);
	let scheme: string = 'https';
	if (!useSecureChannel) {
		scheme = 'http';
		logger.warn(
			`ONDEWO gRPC-web: the channel to ${target} is NOT encrypted (useSecureChannel=false); use it only for local development`
		);
	}
	return {
		hostname: `${scheme}://${target}`,
		options: { withCredentials }
	};
}
