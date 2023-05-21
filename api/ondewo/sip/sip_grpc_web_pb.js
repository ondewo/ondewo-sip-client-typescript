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
 *   !proto.ondewo.sip.SipStartSessionRequest,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipStartSession = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipStartSession',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.SipStartSessionRequest,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.ondewo.sip.SipStartSessionRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.SipStartSessionRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.sipStartSession = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipStartSession',
		request,
		metadata || {},
		methodDescriptor_Sip_SipStartSession,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.SipStartSessionRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.sipStartSession = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipStartSession',
		request,
		metadata || {},
		methodDescriptor_Sip_SipStartSession
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipEndSession = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipEndSession',
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
proto.ondewo.sip.SipClient.prototype.sipEndSession = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipEndSession',
		request,
		metadata || {},
		methodDescriptor_Sip_SipEndSession,
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
proto.ondewo.sip.SipPromiseClient.prototype.sipEndSession = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipEndSession',
		request,
		metadata || {},
		methodDescriptor_Sip_SipEndSession
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.SipStartCallRequest,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipStartCall = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipStartCall',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.SipStartCallRequest,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.ondewo.sip.SipStartCallRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.SipStartCallRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.sipStartCall = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipStartCall',
		request,
		metadata || {},
		methodDescriptor_Sip_SipStartCall,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.SipStartCallRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.sipStartCall = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipStartCall',
		request,
		metadata || {},
		methodDescriptor_Sip_SipStartCall
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.SipEndCallRequest,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipEndCall = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipEndCall',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.SipEndCallRequest,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.ondewo.sip.SipEndCallRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.SipEndCallRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.sipEndCall = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipEndCall',
		request,
		metadata || {},
		methodDescriptor_Sip_SipEndCall,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.SipEndCallRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.sipEndCall = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipEndCall',
		request,
		metadata || {},
		methodDescriptor_Sip_SipEndCall
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.SipTransferCallRequest,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipTransferCall = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipTransferCall',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.SipTransferCallRequest,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.ondewo.sip.SipTransferCallRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.SipTransferCallRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.sipTransferCall = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipTransferCall',
		request,
		metadata || {},
		methodDescriptor_Sip_SipTransferCall,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.SipTransferCallRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.sipTransferCall = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipTransferCall',
		request,
		metadata || {},
		methodDescriptor_Sip_SipTransferCall
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.SipRegisterAccountRequest,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipRegisterAccount = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipRegisterAccount',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.SipRegisterAccountRequest,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.ondewo.sip.SipRegisterAccountRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.SipRegisterAccountRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.sipRegisterAccount = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipRegisterAccount',
		request,
		metadata || {},
		methodDescriptor_Sip_SipRegisterAccount,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.SipRegisterAccountRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.sipRegisterAccount = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipRegisterAccount',
		request,
		metadata || {},
		methodDescriptor_Sip_SipRegisterAccount
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipGetSipStatus = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipGetSipStatus',
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
proto.ondewo.sip.SipClient.prototype.sipGetSipStatus = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipGetSipStatus',
		request,
		metadata || {},
		methodDescriptor_Sip_SipGetSipStatus,
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
proto.ondewo.sip.SipPromiseClient.prototype.sipGetSipStatus = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipGetSipStatus',
		request,
		metadata || {},
		methodDescriptor_Sip_SipGetSipStatus
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatusHistoryResponse>}
 */
const methodDescriptor_Sip_SipGetSipStatusHistory = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipGetSipStatusHistory',
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
proto.ondewo.sip.SipClient.prototype.sipGetSipStatusHistory = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipGetSipStatusHistory',
		request,
		metadata || {},
		methodDescriptor_Sip_SipGetSipStatusHistory,
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
proto.ondewo.sip.SipPromiseClient.prototype.sipGetSipStatusHistory = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipGetSipStatusHistory',
		request,
		metadata || {},
		methodDescriptor_Sip_SipGetSipStatusHistory
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.ondewo.sip.SipPlayWavFilesRequest,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipPlayWavFiles = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipPlayWavFiles',
	grpc.web.MethodType.UNARY,
	proto.ondewo.sip.SipPlayWavFilesRequest,
	proto.ondewo.sip.SipStatus,
	/**
	 * @param {!proto.ondewo.sip.SipPlayWavFilesRequest} request
	 * @return {!Uint8Array}
	 */
	function (request) {
		return request.serializeBinary();
	},
	proto.ondewo.sip.SipStatus.deserializeBinary
);

/**
 * @param {!proto.ondewo.sip.SipPlayWavFilesRequest} request The
 *     request proto
 * @param {?Object<string, string>} metadata User defined
 *     call metadata
 * @param {function(?grpc.web.RpcError, ?proto.ondewo.sip.SipStatus)}
 *     callback The callback function(error, response)
 * @return {!grpc.web.ClientReadableStream<!proto.ondewo.sip.SipStatus>|undefined}
 *     The XHR Node Readable Stream
 */
proto.ondewo.sip.SipClient.prototype.sipPlayWavFiles = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipPlayWavFiles',
		request,
		metadata || {},
		methodDescriptor_Sip_SipPlayWavFiles,
		callback
	);
};

/**
 * @param {!proto.ondewo.sip.SipPlayWavFilesRequest} request The
 *     request proto
 * @param {?Object<string, string>=} metadata User defined
 *     call metadata
 * @return {!Promise<!proto.ondewo.sip.SipStatus>}
 *     Promise that resolves to the response
 */
proto.ondewo.sip.SipPromiseClient.prototype.sipPlayWavFiles = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipPlayWavFiles',
		request,
		metadata || {},
		methodDescriptor_Sip_SipPlayWavFiles
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipMute = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipMute',
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
proto.ondewo.sip.SipClient.prototype.sipMute = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipMute',
		request,
		metadata || {},
		methodDescriptor_Sip_SipMute,
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
proto.ondewo.sip.SipPromiseClient.prototype.sipMute = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipMute',
		request,
		metadata || {},
		methodDescriptor_Sip_SipMute
	);
};

/**
 * @const
 * @type {!grpc.web.MethodDescriptor<
 *   !proto.google.protobuf.Empty,
 *   !proto.ondewo.sip.SipStatus>}
 */
const methodDescriptor_Sip_SipUnMute = new grpc.web.MethodDescriptor(
	'/ondewo.sip.Sip/SipUnMute',
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
proto.ondewo.sip.SipClient.prototype.sipUnMute = function (request, metadata, callback) {
	return this.client_.rpcCall(
		this.hostname_ + '/ondewo.sip.Sip/SipUnMute',
		request,
		metadata || {},
		methodDescriptor_Sip_SipUnMute,
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
proto.ondewo.sip.SipPromiseClient.prototype.sipUnMute = function (request, metadata) {
	return this.client_.unaryCall(
		this.hostname_ + '/ondewo.sip.Sip/SipUnMute',
		request,
		metadata || {},
		methodDescriptor_Sip_SipUnMute
	);
};

module.exports = proto.ondewo.sip;
