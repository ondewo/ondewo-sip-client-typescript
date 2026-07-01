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

// Minimal, idiomatic usage example for `@ondewo/sip-client-typescript`.
//
// It shows the current auth convention of this SDK -- a Keycloak bearer token obtained from the D18
// headless-SDK helper (`auth/offlineTokenProvider.ts`) and passed as an `Authorization: Bearer <token>`
// gRPC-web metadata header -- then constructs the generated `SipPromiseClient`, calls a representative
// RPC (`sipStartSession`), and reads the returned `SipStatus`.
//
// The request-building / response-handling logic is factored into small exported functions so it can be
// unit-tested with the gRPC client mocked (see `ts-client.spec.ts`). `main()` does the real network I/O
// and is only run when the file is executed directly.

import * as grpcWeb from "grpc-web";

import { SipPromiseClient } from "../api/ondewo/sip/sip_grpc_web_pb";
import { SipStartSessionRequest, SipStatus } from "../api/ondewo/sip/sip_pb";
import { login, OfflineTokenProvider } from "../auth/offlineTokenProvider";

/**
 * The subset of the generated {@link SipPromiseClient} surface this example relies on. Declaring it as a
 * structural interface lets the unit test inject a mock while the real promise client satisfies it as-is.
 */
export interface SipSessionClient {
  /** Start a SIP session for an account and resolve with the resulting {@link SipStatus}. */
  sipStartSession(request: SipStartSessionRequest, metadata?: grpcWeb.Metadata): Promise<SipStatus>;
}

/**
 * Build the gRPC-web metadata carrying the bearer token for an authenticated call.
 *
 * @param authorizationHeader - The `Bearer <access_token>` value, e.g. from
 *   {@link OfflineTokenProvider.getAuthorizationHeader}.
 * @returns Metadata with a single `Authorization` header.
 */
export function buildAuthorizationMetadata(authorizationHeader: string): grpcWeb.Metadata {
  return { Authorization: authorizationHeader };
}

/**
 * Build a {@link SipStartSessionRequest} with the given account name and auto-answer interval.
 *
 * @param accountName - The SIP account to start the session for.
 * @param autoAnswerIntervalInS - Seconds before an incoming call is auto-answered (0 disables it).
 * @returns The populated request message.
 */
export function buildStartSessionRequest(accountName: string, autoAnswerIntervalInS: number): SipStartSessionRequest {
  const request: SipStartSessionRequest = new SipStartSessionRequest();
  request.setAccountName(accountName);
  request.setAutoAnswerInterval(autoAnswerIntervalInS);
  return request;
}

/**
 * Start a SIP session on the server: build the request, attach the bearer metadata, call the RPC, and
 * return the plain-object view of the {@link SipStatus} response.
 *
 * @param client - A (real or mocked) SIP promise client.
 * @param authorizationHeader - The `Bearer <access_token>` header value for the call.
 * @param accountName - The SIP account to start the session for.
 * @param autoAnswerIntervalInS - Seconds before an incoming call is auto-answered (0 disables it).
 * @returns The server's {@link SipStatus} as a plain object.
 */
export async function startSipSession(
  client: SipSessionClient,
  authorizationHeader: string,
  accountName: string,
  autoAnswerIntervalInS: number
): Promise<SipStatus.AsObject> {
  const request: SipStartSessionRequest = buildStartSessionRequest(accountName, autoAnswerIntervalInS);
  const metadata: grpcWeb.Metadata = buildAuthorizationMetadata(authorizationHeader);
  const status: SipStatus = await client.sipStartSession(request, metadata);
  return status.toObject();
}

/* c8 ignore start -- main() performs real Keycloak + gRPC-web network I/O and is not run by the unit test */
/**
 * Wire the auth provider and the generated promise client together and start a SIP session. Reads its
 * configuration from environment variables (with example defaults) so it can be run directly:
 *
 *   node --experimental-strip-types examples/ts-client.ts
 */
async function main(): Promise<void> {
  const provider: OfflineTokenProvider = await login({
    keycloakUrl: process.env.ONDEWO_KEYCLOAK_URL ?? "https://auth.example.com/auth",
    realm: process.env.ONDEWO_KEYCLOAK_REALM ?? "ondewo-ccai-platform",
    clientId: process.env.ONDEWO_SDK_CLIENT_ID ?? "ondewo-nlu-cai-sdk-public",
    username: process.env.ONDEWO_SIP_USER_NAME ?? "tech-user@example.com",
    password: process.env.ONDEWO_SIP_PASSWORD ?? "super-secret"
  });
  try {
    // gRPC-web talks to the envoy proxy in front of the SIP server, not the raw gRPC port.
    const grpcWebUrl: string = process.env.ONDEWO_SIP_GRPC_WEB_URL ?? "http://localhost:8080";
    const client: SipSessionClient = new SipPromiseClient(grpcWebUrl);
    const accountName: string = process.env.ONDEWO_SIP_ACCOUNT_NAME ?? "default";
    const status: SipStatus.AsObject = await startSipSession(
      client,
      provider.getAuthorizationHeader(),
      accountName,
      0
    );
    console.log(`SIP session started for account "${status.accountName}" (status type ${status.statusType})`);
  } finally {
    // Always stop the background token-refresh loop so the process can exit.
    provider.stop();
  }
}

if (require.main === module) {
  void main().catch((error: unknown): void => {
    console.error(error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
