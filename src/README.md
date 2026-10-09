<div align="center">
  <table>
    <tr>
      <td>
        <a href="https://ondewo.com/en/products/natural-language-understanding/">
            <img width="400px" src="https://raw.githubusercontent.com/ondewo/ondewo-logos/master/ondewo_we_automate_your_phone_calls.png"/>
        </a>
      </td>
    </tr>
    <tr>
       <td align="center">
          <a href="https://www.linkedin.com/company/ondewo "><img width="40px" src="https://cdn-icons-png.flaticon.com/512/3536/3536505.png"></a>
          <a href="https://www.facebook.com/ondewo"><img width="40px" src="https://cdn-icons-png.flaticon.com/512/733/733547.png"></a>
          <a href="https://twitter.com/ondewo"><img width="40px" src="https://cdn-icons-png.flaticon.com/512/733/733579.png"> </a>
          <a href="https://www.instagram.com/ondewo.ai/"><img width="40px" src="https://cdn-icons-png.flaticon.com/512/174/174855.png"></a>
          <a href="https://badge.fury.io/js/%40ondewo%2Fsip-client-typescript"><img src="https://badge.fury.io/js/%40ondewo%2Fsip-client-typescript.svg" alt="npm version" height="32"></a>
       </td>
    </tr>
  </table>
  <h1 align="center">
    ONDEWO SIP Client Typescript
  </h1>
</div>

## Overview

`@ondewo/sip-client-typescript` is a compiled version of the [ONDEWO SIP API](https://github.com/ondewo/ondewo-sip-api) using the [ONDEWO PROTO COMPILER](https://github.com/ondewo/ondewo-proto-compiler). Here you can find the SIP API [documentation](https://ondewo.github.io).

ONDEWO APIs use [Protocol Buffers](https://github.com/google/protobuf) version 3 (proto3) as their Interface Definition Language (IDL) to define the API interface and the structure of the payload messages. The same interface definition is used for gRPC versions of the API in all languages.

## Setup

Using NPM:

```shell
npm i --save @ondewo/sip-client-typescript
```

Using GitHub:

```shell
git clone https://github.com/ondewo/ondewo-sip-client-typescript.git ## Clone repository
cd ondewo-sip-client-typescript                                      ## Change into repo-directoy
make setup_developer_environment_locally                             ## Install dependencies
```

## Package structure

```
npm
├── api
│   ├── google
│   │   └── protobuf
│   │       ├── empty_pb.d.ts
│   │       ├── empty_pb.js
│   │       ├── timestamp_pb.d.ts
│   │       └── timestamp_pb.js
│   └── ondewo
│       └── sip
│           ├── sip_grpc_web_pb.d.ts
│           ├── sip_grpc_web_pb.js
│           ├── sip_pb.d.ts
│           └── sip_pb.js
├── LICENSE
├── package.json
├── public-api.d.ts
└── README.md
```

## TLS, mutual TLS and certificates

This package is a **gRPC-web** client. Its generated clients send every call through the browser's `XMLHttpRequest`
to a gRPC-web proxy (Envoy) in front of the ONDEWO service, so TLS is the browser's TLS: the browser verifies the
server certificate against its own (operating system / browser) trust store, and a client certificate for mutual TLS
can only come from the browser's own certificate store. Page code cannot hand a CA certificate, a client certificate
or a private key to the browser, so this SDK takes none of them; never ship a private key to a browser.

`createGrpcWebEndpoint` turns `host` / `port` / `useSecureChannel` into the `hostname` URL and the client options
every generated `*Client` / `*PromiseClient` takes:

| Mode                           | `createGrpcWebEndpoint` config                                      | Where the certificates live                                                                                                                                      |
|--------------------------------|---------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Plaintext (not for production) | `useSecureChannel: false`                                           | none; builds `http://host:port` and logs a warning naming `host:port`                                                                                            |
| TLS, publicly trusted server   | `useSecureChannel: true` (the default)                              | the server certificate chains to a CA the browser already trusts                                                                                                 |
| TLS, private CA                | `useSecureChannel: true`                                            | install the CA (`ca.pem`) in the operating system or browser trust store                                                                                         |
| Mutual TLS                     | `useSecureChannel: true`, plus `withCredentials: true` cross-origin | install the client certificate and key (`client.p12`) in the operating system or browser certificate store; the proxy requests it and verifies it against its CA |

Rules the code enforces:

- A config carrying `grpcCert`, `grpcClientCert` or `grpcClientKey` (or the Python spellings `grpc_cert`,
  `grpc_client_cert`, `grpc_client_key`) with a non-empty value throws an `Error` naming the field, instead of
  silently ignoring a certificate you meant to use. Empty values are ignored, so a config ported from another ONDEWO
  SDK with blank TLS fields still works.
- `host` is a bare host name or IP address (no scheme, credentials, path or port); a bare IPv6 literal is bracketed
  (`::1` becomes `https://[::1]:50051`). `port` is an integer 1-65535 (number or numeric string).
- `useSecureChannel` and `withCredentials` must be booleans: parse environment strings yourself (`'false'` is refused,
  not read as `true`).
- `useSecureChannel: false` logs a warning naming `host:port` through `console.warn`, or through the logger passed as
  the second argument. No error message renders a value of a refused field or the host of a refused URL.
- `withCredentials: true` is gRPC-web's option for cross-origin calls: only then does the browser send cookies, HTTP
  authentication **and its TLS client certificate** to a proxy on another origin. A same-origin proxy does not need it.

```ts
import { createGrpcWebEndpoint } from '@ondewo/sip-client-typescript/auth/offlineTokenProvider';
import { SipPromiseClient } from '@ondewo/sip-client-typescript/api/ondewo/sip/sip_grpc_web_pb';

const endpoint = createGrpcWebEndpoint({
 host: 'sip.example.com',
 port: 443,
 withCredentials: true // only for mutual TLS against a proxy on another origin
});
const client = new SipPromiseClient(endpoint.hostname, null, endpoint.options);
```

**Node.js.** The generated clients need `XMLHttpRequest`, which Node.js does not provide (a call fails with
`XMLHttpRequest is not defined`), so this package's gRPC calls run in browsers only; in Node.js only the Keycloak
`login` helper is usable. There is therefore no Node.js path for a custom CA or a client certificate in this SDK: for
a server-side client use the ONDEWO Python SDK, or generate a native `@grpc/grpc-js` client from the
[API protos](https://github.com/ondewo/ondewo-sip-api) and pass your PEM files to `credentials.createSsl(ca, clientKey, clientCert)`.

### The proxy side of mutual TLS

The browser only offers a client certificate when the TLS server asks for one. With Envoy as the gRPC-web proxy:

```yaml
transport_socket:
  name: envoy.transport_sockets.tls
  typed_config:
    '@type': type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
    require_client_certificate: true
    common_tls_context:
      tls_certificates:
        - certificate_chain: { filename: /etc/envoy/certs/server.pem }
          private_key: { filename: /etc/envoy/certs/server.key }
      validation_context:
        trusted_ca: { filename: /etc/envoy/certs/ca.pem }
```

For a cross-origin page the CORS policy must allow credentials with an explicit origin (`allow_credentials: true`;
`Access-Control-Allow-Origin: *` is rejected by the browser for a credentialed request). Envoy may in turn connect to
the ONDEWO service over TLS or mutual TLS with its own (upstream) certificate.

### A test PKI with openssl

A CA, a server certificate with SANs, and a client certificate with the `clientAuth` extended key usage, bundled as
PKCS#12 for import into a browser or operating system certificate store. For tests only: the keys are unencrypted.

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 \
  -subj "/CN=Test CA" -keyout ca.key -out ca.pem

printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > server.ext
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=localhost" -keyout server.key -out server.csr
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 \
  -extfile server.ext -out server.pem

printf 'extendedKeyUsage=clientAuth\n' > client.ext
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=my-client" -keyout client.key -out client.csr
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 \
  -extfile client.ext -out client.pem
openssl pkcs12 -export -in client.pem -inkey client.key -certfile ca.pem -name my-client -out client.p12

chmod 600 *.key client.p12
openssl verify -CAfile ca.pem server.pem client.pem
```

Envoy uses `server.pem` / `server.key` and trusts `ca.pem` for its clients; the browser trusts `ca.pem` and imports
`client.p12`.

### TLS security notes

- The private key of a client certificate belongs in the operating system / browser certificate store, never in page
  code, a bundle, `localStorage` or a config file served to the browser. This SDK refuses one rather than carry it.
- `createGrpcWebEndpoint` returns only the URL and `{ withCredentials }`; logging it reveals no secret. The bearer
  token from `login(...)` is a secret: do not log the `Authorization` header or the `OfflineTokenProvider`.
- `withCredentials: true` also sends the page's cookies for the proxy's origin; restrict the proxy's allowed origins.

### TLS troubleshooting

grpc-web reports a failed TLS connection only as a generic error (the browser hides the TLS cause from JavaScript);
the cause is in the browser's developer tools (Console / Network tab):

- **`net::ERR_CERT_AUTHORITY_INVALID`**: the server certificate does not chain to a CA the browser trusts. Install
  the CA in the trust store, or use a publicly trusted certificate.
- **`net::ERR_CERT_COMMON_NAME_INVALID`**: the host you connect to is not among the certificate's subject alternative
  names. Connect by a name in the SAN, or reissue the certificate (an IP needs an `IP:` SAN).
- **`net::ERR_BAD_SSL_CLIENT_AUTH_CERT`** / **`net::ERR_SSL_CLIENT_AUTH_CERT_NEEDED`**: the proxy requires a client
  certificate and the browser offered none, or one not signed by the proxy's `trusted_ca`. Import `client.p12`, pick
  it when the browser asks, and check `openssl verify -CAfile ca.pem client.pem`.
- **Mixed content blocked**: an `https://` page cannot call an `http://` endpoint; use `useSecureChannel: true`.
- **CORS error only with `withCredentials: true`**: the proxy answers with `Access-Control-Allow-Origin: *` or
  without `Access-Control-Allow-Credentials: true`.

[comment]: <> (START OF GITHUB README)

## Build

The `make build` command is dependent on 2 `repositories` and their specified `version`:

- [ondewo-sip-api](https://github.com/ondewo/ondewo-sip-api) -- `SIP_API_GIT_BRANCH` in `Makefile`
- [ondewo-proto-compiler](https://github.com/ondewo/ondewo-proto-compiler) -- `ONDEWO_PROTO_COMPILER_GIT_BRANCH` in `Makefile`

Other than creating the proto-code, `build` also installs the `dev-dependencies` and changes the owner of the proto-code-files from `root` to the `current user`.

In the case that some `google .protos` were not automatically generated, exists the option of creating a `proto-deps.txt` inside the `src` folder. There, import statements can be written the same way as they are in `.proto` files.

```
import "google/api/http.proto"; //Example
  <---- New Line
```

> :warning: The last line in the `proto-deps.txt` needs to be an empty new line, otherwise the compiler will fail

## GitHub Repository - Release Automation

The repository is published to GitHub and NPM by the Automated Release Process of ONDEWO.

TODO after PR merge:

- checkout master

  ```shell
  git checkout master
  ```

- pull the newest state

  ```shell
  git pull
  ```

- Adjust `ONDEWO_SIP_VERSION` in the `Makefile` <br><br>
- Add new Release Notes to `src/RELEASE.md` in following format:

  ```
  ## Release ONDEWO SIP Typescript Client X.X.X    <----- Beginning of Notes

  ...<NOTES>...

  *****************                             <----- End of Notes
  ```

- release

  ```shell
  make ondewo_release
  ```

  <br>
  The release process can be divided into 6 Steps:

1. `build` specified version of the `ondewo-sip-api`
2. `commit and push` all changes in code resulting from the `build`
3. Publish the created `npm` folder to `npmjs.com`
4. Create and push the `release branch` e.g. `release/1.3.20`
5. Create and push the `release tag` e.g. `1.3.20`
6. Create a new `Release` on GitHub

> :warning: The Release Automation checks if the build has created all the proto-code files, but it does not check the code-integrity. Please build and test the generated code prior to starting the release process.

[comment]: <> (END OF GITHUB README)
