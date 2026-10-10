# Release History

*****************

## Release ONDEWO SIP Typescript Client 5.5.0

### New Features

* [[OND211-2443]](https://ondewo.atlassian.net/browse/OND211-2443) Regenerated from
  [ondewo-sip-api 5.5.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.5.0) (was 5.4.0). The new API
  surface in this package:
  * Answering machine detection: `AnsweringMachineDetectionResult` (verdict, cause, confidence, decision time, rule
    and cue ids, action taken, call id), `SipStatus.StatusType.OUTGOING_CALL_ANSWERING_MACHINE_DETECTED = 22`,
    `SipStatus.amdResult`, `SipEndCallRequest.endReason` (`ANSWERING_MACHINE`,
    `ANSWERING_MACHINE_VOICE_MESSAGE_LEFT`, `END_CALL_REASON_TRANSFERRED`) and `SipEndCallRequest.amdResult`, and
    the RPC `sipReportAnsweringMachineDetected`.
  * Call identity: `SipStatus.callId`. A request is scoped to a call with the `x-ondewo-expected-call-id` metadatum
    (refused with `CallScopeMismatch` on a different value).
  * Call-scoped media control: the RPC `sipSetCallMediaControl` (`SipSetCallMediaControlRequest`,
    `MediaControlSetting`, `MediaControlOwner`, `participantsPresent`), reported in `SipStatus.botMuted` and
    `SipStatus.listeningPaused`.
  * Truthful transfers: `SipTransferCallRequest.outcomeTimeoutMs` and `SipStatus.sipResponseCode`.
  * Live call audio messages (`SipCallAudioConfig`, `SipCallAudioFrame`, `SipCallAudioRequest`,
    `SipCallAudioResponse`, `SipCallAudioStarted`, `SipCallAudioStats`, `SipCallAudioEnded`, `SipCallAudioMode`,
    `SipCallAudioEndReason`) and `SipStatus.callAudioStreams`. The `SipStreamCallAudio` RPC itself is bidirectional
    streaming, which gRPC-web cannot express: the generated `SipClient` / `SipPromiseClient` have no method for it.
  * `SipGetSipStatus` and `SipGetSipStatusHistory` declare `idempotency_level = NO_SIDE_EFFECTS` in the proto. The
    gRPC-web clients do not retry, so this changes nothing at runtime here.
* The API change is purely additive: no field, enum value or RPC was renumbered or removed, so code written against
  5.4.x compiles and stays wire-compatible.

### Improvements

* Regenerated with [ondewo-proto-compiler 5.15.5](https://github.com/ondewo/ondewo-proto-compiler/releases/tag/5.15.5)
  (was 5.15.2); `google-protobuf` stays pinned to `4.0.2`, and `tests/bundleStringRoundTrip.spec.ts` stays green.
* Tests: `tests/sipApiSurface.spec.ts` checks that both generated clients expose `sipReportAnsweringMachineDetected`
  and `sipSetCallMediaControl`, that there is no `sipStreamCallAudio` method, that the new `SipStatus` fields survive a
  binary round trip and that the new enum values keep their proto numbers.
* Tracking API Version [5.5.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.5.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 5.4.2

### New Features

* [[OND211-2443]](https://ondewo.atlassian.net/browse/OND211-2443) `createGrpcWebEndpoint({ host, port, useSecureChannel, withCredentials })`
  (`auth/grpcWebEndpoint`, re-exported from `auth/offlineTokenProvider` and the package entry point) builds the
  `hostname` URL and the client options a generated `*Client` / `*PromiseClient` takes. `https://` is the default;
  `useSecureChannel: false` builds `http://` and logs a warning naming `host:port`; a bare IPv6 host is bracketed;
  `host`, `port` and both flags are validated (`'false'` is refused, not read as `true`).
* TLS in a browser is the browser's TLS: the server certificate is checked against the browser / OS trust store and a
  client certificate (mutual TLS) comes from the browser's certificate store. A config carrying a non-empty
  `grpcCert` / `grpcClientCert` / `grpcClientKey` (or `grpc_cert` / `grpc_client_cert` / `grpc_client_key`) is
  therefore refused with an error naming the field, never the value; empty values are ignored. `withCredentials: true`
  lets a cross-origin call present the browser's client certificate. No error message renders a refused value.
* README section "TLS, mutual TLS and certificates": modes, the Envoy side of mutual TLS, a test PKI with openssl,
  security notes and troubleshooting. Documented gap: the generated clients need `XMLHttpRequest`, so gRPC calls run
  in browsers only; in Node.js only the Keycloak `login` helper is usable and there is no Node.js path for a custom CA
  or client certificate.

### Bug Fixes

* [[OND211-2443]](https://ondewo.atlassian.net/browse/OND211-2443) `OfflineTokenProvider` no longer leaks its tokens
  when logged: `JSON.stringify`, `console.log` and `util.inspect` of a provider (also nested in another object) render
  the access and refresh tokens as `***REDACTED***`. `getAuthorizationHeader()` is unchanged.
* The npm package now ships the hand-written `auth/` module: the Keycloak `login` helper / `OfflineTokenProvider`
  (`auth/offlineTokenProvider`) and `auth/grpcWebEndpoint`, re-exported from the package entry point. Up to 5.4.1
  `create_npm_package` never compiled `auth/`, so the Keycloak helper was not published.
* `google-protobuf` is pinned to `4.0.2` (was exactly `3.21.4`). The generated code, regenerated with
  [ondewo-proto-compiler 5.15.2](https://github.com/ondewo/ondewo-proto-compiler/releases/tag/5.15.2),
  calls `reader.readStringRequireUtf8()` and `jspb.internal.public_for_gencode.serializeMapToBinary()`,
  which 3.21.4 does not have: with the old pin every `deserializeBinary` of a message carrying a string would throw
  `TypeError: reader.readStringRequireUtf8 is not a function` (the defect nlu-client-typescript 7.1.0-7.1.2 and
  csi-client-typescript 5.5.0-5.5.2 shipped). No released version of this package was affected. The regenerated
  `api/` is committed with this release.
* Guard: `tests/bundleStringRoundTrip.spec.ts` round-trips a string with multi-byte characters through the generated
  code; against google-protobuf 3.21.4 it reports 0 passed, 2 failed with that exact TypeError.

### Improvements

* Tests: the endpoint helper's edge cases, including calls through the real grpc-web runtime with a recording
  `XMLHttpRequest`, and the token redaction. `tests/releaseNotes.spec.ts` pins the RELEASE.md heading spelling the
  Makefile slices, a `*****` separator ending every section, and non-empty notes for the version being released.
* RELEASE.md: every section now ends at its separator (the last one ran to the end of the file).
* The release tolerates an empty "Preparing for Release" commit and commits `auth/` and the generated `README.md`.
* Tracking API Version [5.4.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.4.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 5.4.1

### Bug Fixes

* [[OND221-2830]](https://ondewo.atlassian.net/browse/OND221-2830) Regenerated with [ondewo-proto-compiler 5.13.0](https://github.com/ondewo/ondewo-proto-compiler/releases/tag/5.13.0).
* [[OND221-2830]](https://ondewo.atlassian.net/browse/OND221-2830) The hand-written `auth/` surface is now re-exported from the generated public-api barrel. It was compiled and shipped inside the package but nothing re-exported it, so importing a symbol from the package root did not resolve and consumers could only deep-import the module. The re-export is emitted by the compiler, so it survives the regeneration that rewrites the barrel on every build.
* [[OND221-2830]](https://ondewo.atlassian.net/browse/OND221-2830) Tooling: `conventional-pre-commit` now runs before `giticket` at the commit-msg stage - with giticket first, its `[OND221-2830] fix: ...` rewrite was no longer valid Conventional Commits and every commit on a ticket branch failed. `README.md` is prettier-ignored where `.prettierrc` sets `useTabs` and markdownlint's MD010 de-tabs the same blocks, and the codegen `docker run` invocations no longer pass `-it`, which fails outside a TTY.

*****************

## Release ONDEWO SIP Typescript Client 5.4.0

### Improvements

* Tracking API Version [5.4.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.4.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 5.3.0

### Improvements

* Tracking API Version [5.3.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.3.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 5.2.0

### Improvements

* Tracking API Version [5.2.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.2.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 5.1.0

### Improvements

* Tracking API Version [5.1.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.1.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 5.0.0

### Improvements

* Tracking API Version [5.0.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/5.0.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 4.0.0

### Improvements

* Tracking API Version [4.0.0](https://github.com/ondewo/ondewo-sip-api/releases/tag/4.0.0) ( [Documentation](https://ondewo.github.io/ondewo-sip-api/) )

*****************

## Release ONDEWO SIP Typescript Client 3.1.0

### Improvements

* Update to SIP client version tag 3.1.0
* [[OND211-2039]](https://ondewo.atlassian.net/browse/OND211-2039) - Implemented automated release for GitHub and NPM
* [[OND211-2039]](https://ondewo.atlassian.net/browse/OND211-2039) - Added pre-commit hooks and adjusted files to them

*****************
