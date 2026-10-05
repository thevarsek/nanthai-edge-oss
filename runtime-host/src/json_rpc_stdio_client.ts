import type { Writable } from "node:stream";

import { OwnedProcess, type OwnedProcessSpec } from "./process_tree.ts";
import {
  JsonRpcProtocolError,
  JsonRpcRemoteError,
  classifyJsonRpc,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcInbound,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./json_rpc_types.ts";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type MessageListener = (message: JsonRpcRequest | JsonRpcNotification) => void;
type FailureListener = (error: Error) => void;

export type JsonRpcClientOptions = {
  maxLineBytes?: number;
  requestTimeoutMs?: number;
  dialect?: "jsonrpc2" | "codex_app_server";
};

export class JsonRpcStdioClient {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly failureListeners = new Set<FailureListener>();
  private readonly maxLineBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly dialect: NonNullable<JsonRpcClientOptions["dialect"]>;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private closed = false;

  private constructor(private readonly process: OwnedProcess, options: JsonRpcClientOptions) {
    this.maxLineBytes = options.maxLineBytes ?? 2 * 1024 * 1024;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.dialect = options.dialect ?? "jsonrpc2";
    process.child.stdout.setEncoding("utf8");
    process.child.stdout.on("data", (chunk: string) => this.receive(chunk));
    process.child.stderr.resume();
    void process.exit.then(
      (exit) => this.fail(new Error(`JSON-RPC child exited (${exit.code ?? exit.signal})`)),
      (error: unknown) => this.fail(asError(error)),
    );
  }

  static spawn(spec: OwnedProcessSpec, options: JsonRpcClientOptions = {}): JsonRpcStdioClient {
    return new JsonRpcStdioClient(OwnedProcess.spawn(spec), options);
  }

  get pid(): number {
    return this.process.pid;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onFailure(listener: FailureListener): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.ensureOpen();
    const id = this.nextRequestId++;
    const message = params === undefined
      ? { jsonrpc: "2.0" as const, id, method }
      : { jsonrpc: "2.0" as const, id, method, params };
    const result = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method}`));
      }, this.requestTimeoutMs);
      timeout.unref();
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.write(message);
    return result;
  }

  notify(method: string, params?: unknown): void {
    this.ensureOpen();
    this.write(params === undefined
      ? { jsonrpc: "2.0", method }
      : { jsonrpc: "2.0", method, params });
  }

  respond(id: JsonRpcId, result?: unknown, error?: JsonRpcError): void {
    this.ensureOpen();
    if (error !== undefined) {
      this.write({ jsonrpc: "2.0", id, error });
      return;
    }
    this.write(result === undefined
      ? { jsonrpc: "2.0", id, result: null }
      : { jsonrpc: "2.0", id, result });
  }

  async close(graceMs = 500): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectPending(new Error("JSON-RPC client closed"));
    this.process.child.stdin.end();
    await this.process.terminate(graceMs);
  }

  private receive(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trimEnd();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        this.fail(new JsonRpcProtocolError("JSON-RPC line exceeded the byte limit"));
        return;
      }
      if (line.length > 0) {
        this.parseLine(line);
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.maxLineBytes) {
      this.fail(new JsonRpcProtocolError("Unterminated JSON-RPC line exceeded the byte limit"));
    }
  }

  private parseLine(line: string): void {
    try {
      const message = classifyJsonRpc(
        JSON.parse(line) as unknown,
        this.dialect === "codex_app_server",
      );
      if ("method" in message) {
        for (const listener of this.messageListeners) {
          listener(message);
        }
      } else {
        this.resolveResponse(message);
      }
    } catch (error) {
      this.fail(asError(error));
    }
  }

  private resolveResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      this.fail(new JsonRpcProtocolError(`Unknown JSON-RPC response id: ${response.id}`));
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if (response.error !== undefined) {
      pending.reject(new JsonRpcRemoteError(
        response.error.code,
        response.error.message,
        response.error.data,
      ));
    } else {
      pending.resolve(response.result);
    }
  }

  private write(message: JsonRpcInbound): void {
    const stdin: Writable = this.process.child.stdin;
    const wire = this.dialect === "codex_app_server"
      ? withoutVersion(message)
      : message;
    stdin.write(`${JSON.stringify(wire)}\n`);
  }

  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectPending(error);
    for (const listener of this.failureListeners) {
      listener(error);
    }
    void this.process.terminate();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("JSON-RPC client is closed");
    }
  }
}

function withoutVersion(message: JsonRpcInbound): Omit<JsonRpcInbound, "jsonrpc"> {
  const { jsonrpc, ...wire } = message;
  void jsonrpc;
  return wire;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
