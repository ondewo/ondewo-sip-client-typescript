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

// Unit tests for the SIP client example. The gRPC promise client is mocked -- there is NO network access
// and no live SIP server -- so the tests prove the example builds the right request, attaches the bearer
// auth metadata, and handles the response.
//   node --test .test-build/examples/ts-client.spec.js

import { test as runTestCase } from "node:test";
import assert from "node:assert/strict";

import * as grpcWeb from "grpc-web";

import { SipStartSessionRequest, SipStatus } from "../api/ondewo/sip/sip_pb";
import {
  buildAuthorizationMetadata,
  buildStartSessionRequest,
  startSipSession,
  type SipSessionClient
} from "./ts-client";

/** SIP account used both as the request input and the expected value on the response. */
const ACCOUNT_NAME: string = "sip-account-1";
/** Bearer header used as the call's authorization and asserted on the recorded metadata. */
const AUTHORIZATION_HEADER: string = "Bearer access-token-1";
/** Auto-answer interval (seconds) used as the request input and asserted on the recorded request. */
const AUTO_ANSWER_INTERVAL_IN_S: number = 5;

/** A single `sipStartSession` invocation captured by the client stub. */
interface RecordedSessionCall {
  /** The request message the stub was called with. */
  request: SipStartSessionRequest;
  /** The metadata the stub received (carries the `Authorization` header). */
  metadata: grpcWeb.Metadata | undefined;
}

/** The stubbed SIP client plus the calls it recorded, returned by {@link makeSipClientStub}. */
interface SipClientStub {
  /** The stub to pass where a {@link SipSessionClient} is expected. */
  client: SipSessionClient;
  /** Calls captured so far, in invocation order. */
  calls: RecordedSessionCall[];
}

/**
 * Build a mock {@link SipSessionClient} that records each call and resolves with a fixed status.
 *
 * @param status - The {@link SipStatus} the stub resolves `sipStartSession` with.
 * @returns The stub client and the live array of recorded calls.
 */
function makeSipClientStub(status: SipStatus): SipClientStub {
  const calls: RecordedSessionCall[] = [];
  const client: SipSessionClient = {
    sipStartSession(request: SipStartSessionRequest, metadata?: grpcWeb.Metadata): Promise<SipStatus> {
      calls.push({ request, metadata });
      return Promise.resolve(status);
    }
  };
  return { client, calls };
}

runTestCase("buildAuthorizationMetadata puts the bearer token in a single Authorization header", () => {
  const metadata: grpcWeb.Metadata = buildAuthorizationMetadata(AUTHORIZATION_HEADER);
  assert.deepEqual(metadata, { Authorization: AUTHORIZATION_HEADER });
});

runTestCase("buildStartSessionRequest sets the account name and auto-answer interval", () => {
  const request: SipStartSessionRequest = buildStartSessionRequest(ACCOUNT_NAME, AUTO_ANSWER_INTERVAL_IN_S);
  assert.equal(request.getAccountName(), ACCOUNT_NAME);
  assert.equal(request.getAutoAnswerInterval(), AUTO_ANSWER_INTERVAL_IN_S);
});

runTestCase("startSipSession sends the built request with bearer metadata and returns the status", async () => {
  const status: SipStatus = new SipStatus();
  status.setAccountName(ACCOUNT_NAME);
  status.setStatusType(SipStatus.StatusType.SESSION_STARTED);
  const stub: SipClientStub = makeSipClientStub(status);

  const result: SipStatus.AsObject = await startSipSession(
    stub.client,
    AUTHORIZATION_HEADER,
    ACCOUNT_NAME,
    AUTO_ANSWER_INTERVAL_IN_S
  );

  // Exactly one RPC, carrying the built request and the bearer auth metadata.
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].request.getAccountName(), ACCOUNT_NAME);
  assert.equal(stub.calls[0].request.getAutoAnswerInterval(), AUTO_ANSWER_INTERVAL_IN_S);
  assert.deepEqual(stub.calls[0].metadata, { Authorization: AUTHORIZATION_HEADER });

  // The response is surfaced as a plain object the caller can read.
  assert.equal(result.accountName, ACCOUNT_NAME);
  assert.equal(result.statusType, SipStatus.StatusType.SESSION_STARTED);
});

runTestCase("startSipSession propagates an RPC error from the SIP service", async () => {
  const rpcError: grpcWeb.RpcError = new grpcWeb.RpcError(
    grpcWeb.StatusCode.UNAVAILABLE,
    "sip backend unavailable",
    {}
  );
  const client: SipSessionClient = {
    sipStartSession(): Promise<SipStatus> {
      return Promise.reject(rpcError);
    }
  };

  await assert.rejects(
    () => startSipSession(client, AUTHORIZATION_HEADER, ACCOUNT_NAME, AUTO_ANSWER_INTERVAL_IN_S),
    (error: unknown): boolean => error === rpcError
  );
});
