/**
 * @fileoverview gRPC-Web generated client stub for ondewo.sip
 * @enhanceable
 * @public
 */

// GENERATED CODE -- DO NOT EDIT!

/* eslint-disable */
// @ts-nocheck

const grpc = {};
grpc.web = require('grpc-web');

var google_protobuf_empty_pb = require('google-protobuf/google/protobuf/empty_pb.js');

var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');
const proto = {};
proto.ondewo = {};
proto.ondewo.sip = require('./sip_pb.js');

/**
 * @param {string} hostname
 * @param {?Object} credentials
 * @param {?grpc.web.ClientOptions} options
 * @constructor
 * @struct
 * @final
 */
proto.ondewo.sip.SipClient = function (hostname, credentials, options) {
	if (!options) options = {};
	options.format = 'binary';

	/**
	 * @private @const {!grpc.web.GrpcWebClientBase} The client
	 */
	this.client_ = new grpc.web.GrpcWebClientBase(options);

	/**
	 * @private @const {string} The hostname
	 */
	this.hostname_ = hostname;
};

/**
 * @param {string} hostname
 * @param {?Object} credentials
 * @param {?grpc.web.ClientOptions} options
 * @constructor
 * @struct
 * @final
 */
proto.ondewo.sip.SipPromiseClient = function (hostname, credentials, options) {
	if (!options) options = {};
	options.format = 'binary';

	/**
	 * @private @const {!grpc.web.GrpcWebClientBase} The client
	 */
	this.client_ = new grpc.web.GrpcWebClientBase(options);

	/**
	 * @private @const {string} The hostname
	 */
	this.hostname_ = hostname;
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.StartSessionRequest,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_StartSession = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/StartSession',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.StartSessionRequest,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.ondewo.sip.StartSessionRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.StartSessionRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.startSession = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/StartSession',
		request,
		metadata || {},
		methodDescriptor_Sip_StartSession,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.StartSessionRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.startSession = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/StartSession',
		request,
		metadata || {},
		methodDescriptor_Sip_StartSession
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_EndSession = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/EndSession',
	grpc.web.MethodType.UNARY,
	google_protobuf_empty_pb.Empty,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.google.protobuf.Empty} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.endSession = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/EndSession',
		request,
		metadata || {},
		methodDescriptor_Sip_EndSession,
		callback
	);
};

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.endSession = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/EndSession',
		request,
		metadata || {},
		methodDescriptor_Sip_EndSession
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.StartCallRequest,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_StartCall = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/StartCall',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.StartCallRequest,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.ondewo.sip.StartCallRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.StartCallRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.startCall = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/StartCall',
		request,
		metadata || {},
		methodDescriptor_Sip_StartCall,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.StartCallRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.startCall = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/StartCall',
		request,
		metadata || {},
		methodDescriptor_Sip_StartCall
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.EndCallRequest,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_EndCall = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/EndCall',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.EndCallRequest,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.ondewo.sip.EndCallRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.EndCallRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.endCall = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/EndCall',
		request,
		metadata || {},
		methodDescriptor_Sip_EndCall,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.EndCallRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.endCall = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/EndCall',
		request,
		metadata || {},
		methodDescriptor_Sip_EndCall
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.TransferCallRequest,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_TransferCall = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/TransferCall',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.TransferCallRequest,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.ondewo.sip.TransferCallRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.TransferCallRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.transferCall = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/TransferCall',
		request,
		metadata || {},
		methodDescriptor_Sip_TransferCall,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.TransferCallRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.transferCall = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/TransferCall',
		request,
		metadata || {},
		methodDescriptor_Sip_TransferCall
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.RegisterAccountRequest,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_RegisterAccount = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/RegisterAccount',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.RegisterAccountRequest,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.ondewo.sip.RegisterAccountRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.RegisterAccountRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.registerAccount = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/RegisterAccount',
		request,
		metadata || {},
		methodDescriptor_Sip_RegisterAccount,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.RegisterAccountRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.registerAccount = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/RegisterAccount',
		request,
		metadata || {},
		methodDescriptor_Sip_RegisterAccount
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_GetSipStatus = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/GetSipStatus',
	grpc.web.MethodType.UNARY,
	google_protobuf_empty_pb.Empty,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.google.protobuf.Empty} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.getSipStatus = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/GetSipStatus',
		request,
		metadata || {},
		methodDescriptor_Sip_GetSipStatus,
		callback
	);
};

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.getSipStatus = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/GetSipStatus',
		request,
		metadata || {},
		methodDescriptor_Sip_GetSipStatus
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatusHistoryResponse>}
 */
const methodDescriptor_Sip_GetSipStatusHistory = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/GetSipStatusHistory',
	grpc.web.MethodType.UNARY,
	google_protobuf_empty_pb.Empty,
	proto.ondewo.sip.SipStatusHistoryResponse,
	/**
	 * @param {!proto.google.protobuf.Empty} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatusHistoryResponse.deserializeBinary
);

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatusHistoryResponse)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatusHistoryResponse>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.getSipStatusHistory = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/GetSipStatusHistory',
		request,
		metadata || {},
		methodDescriptor_Sip_GetSipStatusHistory,
		callback
	);
};

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatusHistoryResponse>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.getSipStatusHistory = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/GetSipStatusHistory',
		request,
		metadata || {},
		methodDescriptor_Sip_GetSipStatusHistory
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.PlayWavFilesRequest,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_PlayWavFiles = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/PlayWavFiles',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.PlayWavFilesRequest,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.ondewo.sip.PlayWavFilesRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.PlayWavFilesRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.playWavFiles = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/PlayWavFiles',
		request,
		metadata || {},
		methodDescriptor_Sip_PlayWavFiles,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.PlayWavFilesRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.playWavFiles = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/PlayWavFiles',
		request,
		metadata || {},
		methodDescriptor_Sip_PlayWavFiles
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_Mute = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/Mute',
	grpc.web.MethodType.UNARY,
	google_protobuf_empty_pb.Empty,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.google.protobuf.Empty} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.mute = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/Mute',
		request,
		metadata || {},
		methodDescriptor_Sip_Mute,
		callback
	);
};

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.mute = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/Mute',
		request,
		metadata || {},
		methodDescriptor_Sip_Mute
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.google.protobuf.Empty>}
 */
const methodDescriptor_Sip_UnMute = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/UnMute',
	grpc.web.MethodType.UNARY,
	google_protobuf_empty_pb.Empty,
	google_protobuf_empty_pb.Empty,
	/**
	 * @param {!proto.google.protobuf.Empty} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	google_protobuf_empty_pb.Empty.deserializeBinary
);

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.google.protobuf.Empty)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.google.protobuf.Empty>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.unMute = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/UnMute',
		request,
		metadata || {},
		methodDescriptor_Sip_UnMute,
		callback
	);
};

/**
 * @param {!proto.google.protobuf.Empty} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.google.protobuf.Empty>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.unMute = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/UnMute',
		request,
		metadata || {},
		methodDescriptor_Sip_UnMute
	);
};

module.exports = proto.ondewo.sip;
