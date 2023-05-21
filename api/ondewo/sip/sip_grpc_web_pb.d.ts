import * as grpcWeb from 'grpc-web';

import * as google_protobuf_empty_pb from 'google-protobuf/google/protobuf/empty_pb';
import * as ondewo_sip_sip_pb from '../../ondewo/sip/sip_pb';

export class SipClient {
	constructor(
		hostname: string,
		credentials?: null | { [index: string]: string },
		options?: null | { [index: string]: any }
	);

	sipStartSession(
		request: ondewo_sip_sip_pb.SipStartSessionRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipEndSession(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipStartCall(
		request: ondewo_sip_sip_pb.SipStartCallRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipEndCall(
		request: ondewo_sip_sip_pb.SipEndCallRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipTransferCall(
		request: ondewo_sip_sip_pb.SipTransferCallRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipRegisterAccount(
		request: ondewo_sip_sip_pb.SipRegisterAccountRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipGetSipStatus(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipGetSipStatusHistory(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatusHistoryResponse) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatusHistoryResponse>;

	sipPlayWavFiles(
		request: ondewo_sip_sip_pb.SipPlayWavFilesRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipMute(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	sipUnMute(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;
}

export class SipPromiseClient {
	constructor(
		hostname: string,
		credentials?: null | { [index: string]: string },
		options?: null | { [index: string]: any }
	);

	sipStartSession(
		request: ondewo_sip_sip_pb.SipStartSessionRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipEndSession(
		request: google_protobuf_empty_pb.Empty,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipStartCall(
		request: ondewo_sip_sip_pb.SipStartCallRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipEndCall(
		request: ondewo_sip_sip_pb.SipEndCallRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipTransferCall(
		request: ondewo_sip_sip_pb.SipTransferCallRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipRegisterAccount(
		request: ondewo_sip_sip_pb.SipRegisterAccountRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipGetSipStatus(
		request: google_protobuf_empty_pb.Empty,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipGetSipStatusHistory(
		request: google_protobuf_empty_pb.Empty,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatusHistoryResponse>;

	sipPlayWavFiles(
		request: ondewo_sip_sip_pb.SipPlayWavFilesRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipMute(request: google_protobuf_empty_pb.Empty, metadata?: grpcWeb.Metadata): Promise<ondewo_sip_sip_pb.SipStatus>;

	sipUnMute(request: google_protobuf_empty_pb.Empty, metadata?: grpcWeb.Metadata): Promise<ondewo_sip_sip_pb.SipStatus>;
}
