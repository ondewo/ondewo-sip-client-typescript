import * as grpcWeb from 'grpc-web';

import * as google_protobuf_empty_pb from 'google-protobuf/google/protobuf/empty_pb';
import * as ondewo_sip_sip_pb from '../../ondewo/sip/sip_pb';

export class SipClient {
	constructor(
		hostname: string,
		credentials?: null | { [index: string]: string },
		options?: null | { [index: string]: any }
	);

	startSession(
		request: ondewo_sip_sip_pb.StartSessionRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	endSession(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	startCall(
		request: ondewo_sip_sip_pb.StartCallRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	endCall(
		request: ondewo_sip_sip_pb.EndCallRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	transferCall(
		request: ondewo_sip_sip_pb.TransferCallRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	registerAccount(
		request: ondewo_sip_sip_pb.RegisterAccountRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	getSipStatus(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	getSipStatusHistory(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatusHistoryResponse) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatusHistoryResponse>;

	playWavFiles(
		request: ondewo_sip_sip_pb.PlayWavFilesRequest,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	mute(
		request: google_protobuf_empty_pb.Empty,
		metadata: grpcWeb.Metadata | undefined,
		callback: (err: grpcWeb.RpcError, response: ondewo_sip_sip_pb.SipStatus) => void
	): grpcWeb.ClientReadableStream<ondewo_sip_sip_pb.SipStatus>;

	unMute(
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

	startSession(
		request: ondewo_sip_sip_pb.StartSessionRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	endSession(
		request: google_protobuf_empty_pb.Empty,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	startCall(
		request: ondewo_sip_sip_pb.StartCallRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	endCall(request: ondewo_sip_sip_pb.EndCallRequest, metadata?: grpcWeb.Metadata): Promise<ondewo_sip_sip_pb.SipStatus>;

	transferCall(
		request: ondewo_sip_sip_pb.TransferCallRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	registerAccount(
		request: ondewo_sip_sip_pb.RegisterAccountRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	getSipStatus(
		request: google_protobuf_empty_pb.Empty,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	getSipStatusHistory(
		request: google_protobuf_empty_pb.Empty,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatusHistoryResponse>;

	playWavFiles(
		request: ondewo_sip_sip_pb.PlayWavFilesRequest,
		metadata?: grpcWeb.Metadata
	): Promise<ondewo_sip_sip_pb.SipStatus>;

	mute(request: google_protobuf_empty_pb.Empty, metadata?: grpcWeb.Metadata): Promise<ondewo_sip_sip_pb.SipStatus>;

	unMute(request: google_protobuf_empty_pb.Empty, metadata?: grpcWeb.Metadata): Promise<ondewo_sip_sip_pb.SipStatus>;
}
