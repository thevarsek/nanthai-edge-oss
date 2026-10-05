export type JsonRpcId = number | string;

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

export type JsonRpcInbound =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export class JsonRpcRemoteError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcRemoteError";
  }
}

export class JsonRpcProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonRpcProtocolError";
  }
}

export function classifyJsonRpc(
  value: unknown,
  allowMissingVersion = false,
): JsonRpcInbound {
  if (!isRecord(value)
    || (value.jsonrpc !== "2.0" && !(allowMissingVersion && value.jsonrpc === undefined))) {
    throw new JsonRpcProtocolError("Inbound line is not a JSON-RPC 2.0 message");
  }
  if (!isId(value.id) && value.id !== undefined) {
    throw new JsonRpcProtocolError("JSON-RPC id must be a string or number");
  }
  if (typeof value.method === "string") {
    if (value.id === undefined) {
      return optionalParams(value.method, value.params);
    }
    return request(value.id, value.method, value.params);
  }
  if (value.id === undefined) {
    throw new JsonRpcProtocolError("JSON-RPC response is missing an id");
  }
  if (value.error !== undefined && !isRemoteError(value.error)) {
    throw new JsonRpcProtocolError("JSON-RPC error payload is invalid");
  }
  if (value.error !== undefined && value.result !== undefined) {
    throw new JsonRpcProtocolError("JSON-RPC response has both result and error");
  }
  return response(value.id, value.result, value.error);
}

function request(id: JsonRpcId, method: string, params: unknown): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

function optionalParams(method: string, params: unknown): JsonRpcNotification {
  return params === undefined
    ? { jsonrpc: "2.0", method }
    : { jsonrpc: "2.0", method, params };
}

function response(
  id: JsonRpcId,
  result: unknown,
  error: JsonRpcError | undefined,
): JsonRpcResponse {
  if (error !== undefined) {
    return { jsonrpc: "2.0", id, error };
  }
  return result === undefined
    ? { jsonrpc: "2.0", id }
    : { jsonrpc: "2.0", id, result };
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteError(value: unknown): value is JsonRpcError {
  return (
    isRecord(value) &&
    typeof value.code === "number" &&
    typeof value.message === "string"
  );
}
