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

// THE ONDEWO SIP API 5.5.0 SURFACE IS REACHABLE THROUGH THE GENERATED CLIENT.
//
// Pins that the committed `api/` was regenerated from ondewo-sip-api 5.5.0: the two new unary RPCs are on
// both generated clients, the new status fields survive a binary round trip, and the new enum values carry
// their proto numbers. `SipStreamCallAudio` is bidirectional streaming, which gRPC-web cannot express, so
// the generator emits no method for it -- pinned here so the RELEASE.md statement stays true.
//
//   node --test .test-build/sipApiSurface.spec.js

import nodeTest from 'node:test';
import assert from 'node:assert/strict';

import { SipClient, SipPromiseClient } from '../api/ondewo/sip/sip_grpc_web_pb';
import { AnsweringMachineDetectionResult, SipEndCallRequest, SipStatus } from '../api/ondewo/sip/sip_pb';

/** Host the clients are constructed against; construction opens no connection. */
const HOST: string = 'http://localhost:8080';
/** The unary RPCs ondewo-sip-api 5.5.0 added, by their gRPC-web method names. */
const NEW_UNARY_METHODS: string[] = ['sipReportAnsweringMachineDetected', 'sipSetCallMediaControl'];

nodeTest('both generated clients expose the RPCs added in ondewo-sip-api 5.5.0', (): void => {
	const clients: Record<string, unknown>[] = [
		new SipPromiseClient(HOST) as unknown as Record<string, unknown>,
		new SipClient(HOST) as unknown as Record<string, unknown>
	];
	for (const client of clients) {
		for (const method of NEW_UNARY_METHODS) {
			assert.equal(typeof client[method], 'function', `${method} is missing`);
		}
	}
});

nodeTest('the bidirectional SipStreamCallAudio RPC has no gRPC-web method', (): void => {
	const client: Record<string, unknown> = new SipPromiseClient(HOST) as unknown as Record<string, unknown>;
	assert.equal(typeof client['sipStreamCallAudio'], 'undefined');
});

nodeTest('the new SipStatus fields survive a binary round trip', (): void => {
	const amd: AnsweringMachineDetectionResult = new AnsweringMachineDetectionResult();
	amd.setVerdict(AnsweringMachineDetectionResult.Verdict.MACHINE);
	amd.setCallId('call-äöü-1');
	const status: SipStatus = new SipStatus();
	status.setStatusType(SipStatus.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED);
	status.setCallId('call-äöü-1');
	status.setAmdResult(amd);
	status.setBotMuted(true);
	status.setListeningPaused(true);

	const decoded: SipStatus = SipStatus.deserializeBinary(status.serializeBinary());
	assert.equal(decoded.getStatusType(), SipStatus.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED);
	assert.equal(decoded.getCallId(), 'call-äöü-1');
	assert.equal(decoded.getAmdResult()?.getVerdict(), AnsweringMachineDetectionResult.Verdict.MACHINE);
	assert.equal(decoded.getAmdResult()?.getCallId(), 'call-äöü-1');
	assert.equal(decoded.getBotMuted(), true);
	assert.equal(decoded.getListeningPaused(), true);
});

nodeTest('the new enum values carry their proto numbers', (): void => {
	assert.equal(SipStatus.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED, 22);
	assert.equal(SipEndCallRequest.EndCallReason.ANSWERING_MACHINE, 1);
	assert.equal(SipEndCallRequest.EndCallReason.ANSWERING_MACHINE_VOICE_MESSAGE_LEFT, 2);
	assert.equal(SipEndCallRequest.EndCallReason.END_CALL_REASON_TRANSFERRED, 3);
});
