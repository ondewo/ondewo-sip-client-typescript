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
// THE ONDEWO SIP API SURFACE IS REACHABLE THROUGH THE GENERATED CLIENTS.
//
// The expectations are DERIVED from the protos the client was generated from
// (`src/ondewo-sip-api/ondewo/sip/*.proto`, the api submodule at SIP_API_GIT_BRANCH), so an API release
// that adds an RPC is checked without editing this file. What is pinned by hand is only what must NOT go
// away:
//   * every `service` has a callback and a promise client carrying one method per RPC gRPC-web can express
//     (unary and server-streaming); a client- or bidirectional-streaming RPC (`SipStreamCallAudio`) has
//     no method;
//   * the entry point re-exports every generated sip module and the hand-written auth providers;
//   * the 5.5.0 status fields survive a binary round trip and the 5.5.0 enum values keep their numbers.
//
// Message TYPES are imported through the package entry point `../public-api`, never from the module that
// happens to define them today (a message moving between .proto files is not an API change). The entry
// point is ESM for bundlers and cannot be required by node, so the runtime VALUES are looked up by name
// across the generated sip modules.
//
//   node --test .test-build/surface/tests/sipApiSurface.spec.js

import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import type { AnsweringMachineDetectionResult, SipEndCallRequest, SipStatus } from '../public-api';

/**
 * @param start - The directory to start from.
 * @returns The closest ancestor directory holding the Makefile (the repository root).
 */
function findRepoRoot(start: string): string {
	let dir: string = start;
	while (!existsSync(join(dir, 'Makefile'))) {
		dir = dirname(dir);
	}
	return dir;
}

/** The repository root (the compiled spec runs from a build directory below it). */
const REPO_ROOT: string = findRepoRoot(__dirname);
/** The sip protos the committed `api/` was generated from. */
const PROTO_DIR: string = join(REPO_ROOT, 'src', 'ondewo-sip-api', 'ondewo', 'sip');
/** The generated sip modules. */
const API_DIR: string = join(REPO_ROOT, 'api', 'ondewo', 'sip');
/** Host the clients are constructed against; construction opens no connection. */
const HOST: string = 'http://localhost:8080';
/** Loads a generated CommonJS module by path. */
const loadModule: NodeJS.Require = createRequire(__filename);

/** One `rpc` line of a `service`. */
interface ProtoRpc {
	/** The RPC name as written in the proto. */
	name: string;
	/** True for a client- or bidirectional-streaming RPC, which gRPC-web cannot express. */
	clientStreaming: boolean;
}

/** One `service` block. */
interface ProtoService {
	/** The proto file name without `.proto`. */
	file: string;
	/** The service name. */
	name: string;
	/** Its RPCs. */
	rpcs: ProtoRpc[];
}

/** A generated client constructor, as both the callback and the promise flavour declare it. */
type ClientConstructor = new (hostname: string) => object;

/**
 * @param text - Proto source.
 * @returns The source with `//` and `/* *\/` comments blanked, string literals left intact.
 */
function stripComments(text: string): string {
	let out: string = '';
	let index: number = 0;
	while (index < text.length) {
		let stop: number = index + 1;
		if (text[index] === '"') {
			stop = text.indexOf('"', index + 1) + 1;
			out += text.slice(index, stop);
		} else if (text.startsWith('//', index)) {
			stop = text.indexOf('\n', index);
		} else if (text.startsWith('/*', index)) {
			stop = text.indexOf('*/', index + 2) + 2;
		} else {
			out += text[index];
		}
		if (stop <= index) {
			break;
		}
		index = stop;
	}
	return out;
}

/**
 * @param text - Comment-free proto source.
 * @param open - Index of a `{`.
 * @returns The text between that brace and its matching `}`.
 */
function blockBody(text: string, open: number): string {
	let depth: number = 0;
	for (let index: number = open; index < text.length; index += 1) {
		if (text[index] === '{') {
			depth += 1;
		} else if (text[index] === '}') {
			depth -= 1;
			if (depth === 0) {
				return text.slice(open + 1, index);
			}
		}
	}
	throw new Error('unbalanced braces in a proto service');
}

/** @returns Every service of every sip proto, with its RPCs. */
function protoServices(): ProtoService[] {
	return readdirSync(PROTO_DIR)
		.filter((file: string): boolean => file.endsWith('.proto'))
		.sort()
		.flatMap((file: string): ProtoService[] => {
			const text: string = stripComments(readFileSync(join(PROTO_DIR, file), 'utf8'));
			return [...text.matchAll(/\bservice\s+(\w+)\s*\{/g)].map((service: RegExpExecArray): ProtoService => {
				const body: string = blockBody(text, service.index + service[0].length - 1);
				const rpcs: ProtoRpc[] = [
					...body.matchAll(/\brpc\s+(\w+)\s*\(\s*(stream\s+)?[\w.]+\s*\)\s*returns\s*\(\s*(?:stream\s+)?[\w.]+\s*\)/g)
				].map((rpc: RegExpExecArray): ProtoRpc => ({ name: rpc[1], clientStreaming: rpc[2] !== undefined }));
				return { file: file.replace(/\.proto$/, ''), name: service[1], rpcs };
			});
		});
}

/**
 * @param name - An RPC name.
 * @returns The method name protoc-gen-grpc-web generates for it (first letter lower-cased).
 */
function methodName(name: string): string {
	return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Reads a member off an object without widening the generated type. */
function memberOf(owner: object, name: string): unknown {
	return (owner as Record<string, unknown>)[name];
}

/**
 * @param file - A generated module path relative to `api/ondewo/sip`, without `.js`.
 * @returns The module's exports.
 */
function generatedModule(file: string): Record<string, unknown> {
	return loadModule(join(API_DIR, file)) as Record<string, unknown>;
}

/**
 * @param name - An exported message or enum name.
 * @returns The one generated sip message module export of that name.
 */
function generatedExport<T>(name: string): T {
	// goog's generated modules share one `proto.ondewo.sip` namespace and each re-exports all of it, so the
	// same constructor shows up under several modules: what must be unique is the VALUE.
	const values: Set<unknown> = new Set(
		readdirSync(API_DIR)
			.filter((file: string): boolean => file.endsWith('_pb.js') && !file.endsWith('_grpc_web_pb.js'))
			.map((file: string): unknown => generatedModule(file.replace(/\.js$/, ''))[name])
			.filter((value: unknown): boolean => value !== undefined)
	);
	assert.equal(values.size, 1, `the generated sip modules export exactly one ${name}`);
	return [...values][0] as T;
}

/** The services of the protos, parsed once. */
const SERVICES: ProtoService[] = protoServices();

nodeTest('the sip protos declare the service this client must keep', (): void => {
	const names: string[] = SERVICES.map((service: ProtoService): string => service.name);
	assert.ok(names.includes('Sip'), `service Sip is missing from ${PROTO_DIR}`);
	for (const service of SERVICES) {
		assert.ok(service.rpcs.length > 0, `no rpc parsed from service ${service.name}`);
	}
});

nodeTest('the parser sees the RPCs this client must keep, and SipStreamCallAudio as bidirectional', (): void => {
	const rpcs: Map<string, ProtoRpc> = new Map(
		SERVICES.flatMap((service: ProtoService): [string, ProtoRpc][] =>
			service.rpcs.map((rpc: ProtoRpc): [string, ProtoRpc] => [`${service.name}.${rpc.name}`, rpc])
		)
	);
	for (const required of [
		'Sip.SipStartSession',
		'Sip.SipStartCall',
		'Sip.SipEndCall',
		'Sip.SipTransferCall',
		'Sip.SipGetSipStatus',
		'Sip.SipReportAnsweringMachineDetected',
		'Sip.SipSetCallMediaControl'
	]) {
		assert.equal(rpcs.get(required)?.clientStreaming, false, `${required} is missing or not gRPC-web capable`);
	}
	assert.equal(rpcs.get('Sip.SipStreamCallAudio')?.clientStreaming, true);
});

nodeTest('every RPC gRPC-web can express is on both generated clients of its service', (): void => {
	const missing: string[] = [];
	for (const service of SERVICES) {
		const exports: Record<string, unknown> = generatedModule(`${service.file}_grpc_web_pb`);
		for (const flavour of ['Client', 'PromiseClient']) {
			const Client: ClientConstructor = exports[`${service.name}${flavour}`] as ClientConstructor;
			assert.equal(typeof Client, 'function', `${service.name}${flavour} is not generated`);
			const client: object = new Client(HOST);
			for (const rpc of service.rpcs.filter((candidate: ProtoRpc): boolean => !candidate.clientStreaming)) {
				if (typeof memberOf(client, methodName(rpc.name)) !== 'function') {
					missing.push(`${service.name}${flavour}.${methodName(rpc.name)}`);
				}
			}
		}
	}
	assert.deepEqual(missing, []);
});

nodeTest('a client- or bidirectional-streaming RPC has no gRPC-web method', (): void => {
	const present: string[] = [];
	for (const service of SERVICES) {
		const exports: Record<string, unknown> = generatedModule(`${service.file}_grpc_web_pb`);
		for (const flavour of ['Client', 'PromiseClient']) {
			const client: object = new (exports[`${service.name}${flavour}`] as ClientConstructor)(HOST);
			for (const rpc of service.rpcs.filter((candidate: ProtoRpc): boolean => candidate.clientStreaming)) {
				if (memberOf(client, methodName(rpc.name)) !== undefined) {
					present.push(`${service.name}${flavour}.${methodName(rpc.name)}`);
				}
			}
		}
	}
	assert.deepEqual(present, []);
});

nodeTest('the entry point re-exports every generated sip module', (): void => {
	const protoFiles: string[] = readdirSync(PROTO_DIR)
		.filter((file: string): boolean => file.endsWith('.proto'))
		.map((file: string): string => file.replace(/\.proto$/, ''));
	const expected: string[] = [
		...protoFiles.map((file: string): string => `${file}_pb`),
		...SERVICES.map((service: ProtoService): string => `${service.file}_grpc_web_pb`)
	];
	const missing: string[] = [];
	for (const [entryPoint, suffix] of [
		['public-api.js', ''],
		['public-api.d.ts', '.d']
	]) {
		const text: string = readFileSync(join(REPO_ROOT, entryPoint), 'utf8');
		for (const module of expected) {
			if (!text.includes(`export * from './api/ondewo/sip/${module}${suffix}';`)) {
				missing.push(`${entryPoint}: ${module}`);
			}
		}
	}
	assert.deepEqual(missing, []);
});

nodeTest('the entry point re-exports the hand-written auth providers', (): void => {
	const modules: string[] = readdirSync(join(REPO_ROOT, 'auth'))
		.filter((file: string): boolean => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
		.map((file: string): string => file.replace(/\.ts$/, ''));
	assert.ok(modules.length > 0);
	const missing: string[] = [];
	for (const entryPoint of ['public-api.js', 'public-api.d.ts']) {
		const text: string = readFileSync(join(REPO_ROOT, entryPoint), 'utf8');
		for (const module of modules) {
			if (!text.includes(`export * from './auth/${module}';`)) {
				missing.push(`${entryPoint}: ${module}`);
			}
		}
	}
	assert.deepEqual(missing, []);
});

nodeTest('the 5.5.0 SipStatus fields survive a binary round trip', (): void => {
	const Status: typeof SipStatus = generatedExport<typeof SipStatus>('SipStatus');
	const Amd: typeof AnsweringMachineDetectionResult = generatedExport<typeof AnsweringMachineDetectionResult>(
		'AnsweringMachineDetectionResult'
	);
	const amd: AnsweringMachineDetectionResult = new Amd();
	amd.setVerdict(Amd.Verdict.MACHINE);
	amd.setCallId('call-äöü-1');
	const status: SipStatus = new Status();
	status.setStatusType(Status.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED);
	status.setCallId('call-äöü-1');
	status.setAmdResult(amd);
	status.setBotMuted(true);
	status.setListeningPaused(true);

	const decoded: SipStatus = Status.deserializeBinary(status.serializeBinary());
	assert.equal(decoded.getStatusType(), Status.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED);
	assert.equal(decoded.getCallId(), 'call-äöü-1');
	assert.equal(decoded.getAmdResult()?.getVerdict(), Amd.Verdict.MACHINE);
	assert.equal(decoded.getAmdResult()?.getCallId(), 'call-äöü-1');
	assert.equal(decoded.getBotMuted(), true);
	assert.equal(decoded.getListeningPaused(), true);
});

nodeTest('the 5.5.0 enum values carry their proto numbers', (): void => {
	const Status: typeof SipStatus = generatedExport<typeof SipStatus>('SipStatus');
	const EndCall: typeof SipEndCallRequest = generatedExport<typeof SipEndCallRequest>('SipEndCallRequest');
	assert.equal(Status.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED, 22);
	assert.equal(EndCall.EndCallReason.ANSWERING_MACHINE, 1);
	assert.equal(EndCall.EndCallReason.ANSWERING_MACHINE_VOICE_MESSAGE_LEFT, 2);
	assert.equal(EndCall.EndCallReason.END_CALL_REASON_TRANSFERRED, 3);
});
