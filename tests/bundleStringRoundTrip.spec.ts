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

// A STRING FIELD MUST SURVIVE A BINARY ROUND TRIP THROUGH THE GENERATED CODE.
//
// ondewo-proto-compiler 5.15.2 emits `reader.readStringRequireUtf8()` and
// `jspb.internal.public_for_gencode.serializeMapToBinary()`, neither of which exists in google-protobuf
// 3.21.4 -- which this package pinned EXACTLY. Built with that pair, every `deserializeBinary` on a
// message carrying a string throws `TypeError: reader.readStringRequireUtf8 is not a function` (the
// same defect shipped in nlu-client-typescript 7.1.0-7.1.2 and csi-client-typescript 5.5.0-5.5.2).
// The pin is 4.0.2 now.
//
// Nothing else here could see it: the .proto sources, the generated code, the auth suite and its 100%
// coverage gate are all correct -- the generated code and the RUNTIME DEPENDENCY disagree, and only
// decoding a real message exercises that seam.
//
//   node --test .test-build/bundleStringRoundTrip.spec.js

import nodeTest from 'node:test';
import assert from 'node:assert/strict';

import { SipStartCallRequest } from '../api/ondewo/sip/sip_pb';

/** A value with multi-byte characters, because the emitted reader is the UTF-8-validating one. */
const VALUE: string = 'round-trip-probe-äöü';

nodeTest('a string field survives a binary round trip through the generated code', (): void => {
	const original: SipStartCallRequest = new SipStartCallRequest();
	original.setCalleeId(VALUE);

	const bytes: Uint8Array = original.serializeBinary();
	assert.ok(bytes.length > 0, 'serialization produced no bytes');

	const decoded: SipStartCallRequest = SipStartCallRequest.deserializeBinary(bytes);
	assert.equal(decoded.getCalleeId(), VALUE, 'the string did not survive the round trip');
});

nodeTest('the installed protobuf runtime can read the strings this package writes', (): void => {
	const message: SipStartCallRequest = new SipStartCallRequest();
	message.setCalleeId('probe');

	// Assert the PROPERTY, not the method name: what matters is that decoding works, not which
	// reader the generator happened to emit. A future generator may emit `readString` again.
	assert.doesNotThrow(
		() => SipStartCallRequest.deserializeBinary(message.serializeBinary()),
		'the installed google-protobuf cannot decode a string this package encodes'
	);
});
