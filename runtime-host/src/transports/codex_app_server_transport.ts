import { dynamicToolResponse } from "./app_server_tool_bridge.ts";
import { AsyncEventQueue } from "../async_event_queue.ts";
import { parseCodexAppServerWarning } from "../codex_app_server_warning.ts";
import { APP_SERVER_CAPABILITIES } from "../codex_capabilities.ts";
import type {
  CodexInputPart,
  CodexModel,
  CodexTransport,
  CodexTransportEvent,
  CodexTransportSession,
  StartCodexSessionInput,
} from "../codex_transport.ts";
import { JsonRpcStdioClient } from "../json_rpc_stdio_client.ts";
import type { JsonRpcRequest } from "../json_rpc_types.ts";
import type {
  ActiveAppServerTurn,
  AppServerOptions,
  AppServerSessionState,
} from "./app_server_session_state.ts";
import {
  parseModels,
  parseThreadStart,
  parseTurnId,
  startParams,
  toAppServerInput,
} from "./app_server_protocol_mapping.ts";
import {
  notificationThreadId,
  observedChildThreadId,
  removeThreadTree,
  startedThreadParent,
} from "./app_server_thread_routing.ts";
export class CodexAppServerTransport implements CodexTransport {
  readonly name = "app_server_stdio" as const;
  readonly capabilities = APP_SERVER_CAPABILITIES;
  private readonly sessions = new Map<string, AppServerSessionState>();
  private readonly threadRoots = new Map<string, string>();
  private initialized: Promise<void> | null = null;
  toolHandler: ((request: unknown) => Promise<unknown>) | undefined;
  constructor(private readonly client: JsonRpcStdioClient) {
    client.onMessage((message) => this.receive(message));
    client.onFailure((error) => {
      for (const state of this.sessions.values()) {
        state.activeTurn?.queue.fail(error);
      }
    });
  }
  static spawn(options: AppServerOptions): CodexAppServerTransport {
    return new CodexAppServerTransport(JsonRpcStdioClient.spawn({
      command: options.command,
      args: [...(options.args ?? []), "app-server", "--listen", "stdio://"],
      processGroup: "inherit",
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    }, { dialect: "codex_app_server" }));
  }
  async probe() {
    await this.initialize();
    return this.capabilities;
  }

  async listModels(): Promise<CodexModel[]> {
    await this.initialize();
    const response = await this.client.request("model/list", {});
    return parseModels(response);
  }

  async startSession(input: StartCodexSessionInput): Promise<CodexTransportSession> {
    await this.initialize();
    const response = await this.client.request("thread/start", startParams(input));
    const session = this.createSession(response);
    await this.injectHistory(session, input.injectedHistory);
    return session;
  }

  async resumeSession(
    nativeSessionId: string,
    input: StartCodexSessionInput,
  ): Promise<CodexTransportSession> {
    await this.initialize();
    const response = await this.client.request("thread/resume", {
      threadId: nativeSessionId,
      ...startParams(input),
    });
    const session = this.createSession(response);
    await this.injectHistory(session, input.injectedHistory);
    return session;
  }

  async matchesNativeFrontier(threadId: string, expectedTurnId: string): Promise<boolean> {
    await this.initialize();
    const response = await this.client.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "notLoaded" });
    if (!response || typeof response !== "object" || !("data" in response) || !Array.isArray(response.data)) {
      throw new Error("Codex thread/turns/list returned an incompatible response");
    }
    const turn = response.data[0] as { id?: string; status?: string } | undefined;
    return turn?.id === expectedTurnId && turn.status === "completed";
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    this.state(threadId);
    await this.client.request("thread/name/set", { threadId, name });
  }

  async *sendTurn(
    session: CodexTransportSession,
    input: readonly CodexInputPart[],
  ): AsyncIterable<CodexTransportEvent> {
    const threadId = requireSessionId(session, this.name);
    const state = this.state(threadId);
    if (state.activeTurn !== null) {
      throw new Error("The App Server session already has an active turn");
    }
    const active: ActiveAppServerTurn = {
      queue: new AsyncEventQueue({ maxItems: 512, maxBytes: 4 * 1024 * 1024 }),
      turnId: null,
      cancelPending: state.cancelBeforeStart,
      terminalReceived: false,
    };
    state.turnStarted = true;
    state.activeTurn = active;
    try {
      const response = await this.client.request("turn/start", {
        threadId,
        input: input.map(toAppServerInput),
      });
      active.turnId = parseTurnId(response);
      if (active.cancelPending && !active.terminalReceived) {
        await this.client.request("turn/interrupt", { threadId, turnId: active.turnId });
      }
      for await (const event of active.queue) {
        yield event;
      }
    } finally {
      state.activeTurn = null;
    }
  }

  async cancel(session: CodexTransportSession): Promise<void> {
    const threadId = requireSessionId(session, this.name);
    const state = this.state(threadId);
    const active = state.activeTurn;
    if (active === null) {
      if (!state.turnStarted) {
        state.cancelBeforeStart = true;
        return;
      }
      throw new Error("The App Server session has no cancellable active turn");
    }
    if (active.terminalReceived) return;
    if (active.turnId === null) {
      active.cancelPending = true;
      return;
    }
    await this.client.request("turn/interrupt", { threadId, turnId: active.turnId });
  }

  async respondToApproval(
    session: CodexTransportSession,
    requestId: string | number,
    response: unknown,
  ): Promise<void> {
    requireSessionId(session, this.name);
    this.client.respond(requestId, response);
  }

  async respondToInput(
    session: CodexTransportSession,
    requestId: string | number,
    response: unknown,
  ): Promise<void> {
    requireSessionId(session, this.name);
    this.client.respond(requestId, response);
  }

  async close(session: CodexTransportSession): Promise<void> {
    const threadId = requireSessionId(session, this.name);
    this.sessions.get(threadId)?.activeTurn?.queue.end();
    this.sessions.delete(threadId);
    removeThreadTree(this.threadRoots, threadId);
  }

  async closeProcess(): Promise<void> {
    await this.client.close();
  }

  private async injectHistory(
    session: CodexTransportSession,
    items: readonly Record<string, unknown>[] | undefined,
  ): Promise<void> {
    if (items === undefined || items.length === 0) return;
    await this.client.request("thread/inject_items", {
      threadId: requireSessionId(session, this.name),
      items,
    });
  }

  private async initialize(): Promise<void> {
    this.initialized ??= this.performInitialize();
    return this.initialized;
  }

  private async performInitialize(): Promise<void> {
    await this.client.request("initialize", {
      clientInfo: { name: "nanthai-runtime-host", version: "0.2.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    this.client.notify("initialized");
  }

  private createSession(response: unknown): CodexTransportSession {
    const parsed = parseThreadStart(response);
    this.sessions.set(parsed.threadId, {
      activeTurn: null,
      turnStarted: false,
      cancelBeforeStart: false,
    });
    this.threadRoots.set(parsed.threadId, parsed.threadId);
    return {
      transport: this.name,
      nativeSessionId: parsed.threadId,
      model: parsed.model,
      provider: parsed.provider,
      workingDirectory: parsed.cwd,
    };
  }

  private state(threadId: string): AppServerSessionState {
    const state = this.sessions.get(threadId);
    if (state === undefined) {
      throw new Error("Session does not belong to this App Server transport");
    }
    return state;
  }

  private receive(message: JsonRpcRequest | { method: string; params?: unknown }): void {
    const warning = !("id" in message) && message.method === "warning"
      ? parseCodexAppServerWarning(message.params) : null;
    if (warning?.threadId === null) {
      for (const state of this.sessions.values()) {
        if (state.activeTurn?.terminalReceived) continue;
        state.activeTurn?.queue.push(optionalParams({
          type: "notification", method: message.method,
        }, message.params));
      }
      return;
    }
    const sourceThreadId = warning?.threadId
      ?? notificationThreadId(message.method, message.params);
    if (sourceThreadId === null) return;
    const observedChild = observedChildThreadId(message.method, message.params);
    const sourceRoot = this.threadRoots.get(sourceThreadId);
    if (observedChild !== null && sourceRoot !== undefined) {
      this.threadRoots.set(observedChild, sourceRoot);
    }
    const parentThreadId = startedThreadParent(message.method, message.params);
    const parentRoot = parentThreadId === null ? null : this.threadRoots.get(parentThreadId);
    if (parentRoot !== null && parentRoot !== undefined) {
      this.threadRoots.set(sourceThreadId, parentRoot);
    }
    const rootThreadId = this.threadRoots.get(sourceThreadId) ?? sourceThreadId;
    const active = this.sessions.get(rootThreadId)?.activeTurn;
    if (active === null || active === undefined || active.terminalReceived) return;
    if ("id" in message && message.method === "item/tool/call") {
      void dynamicToolResponse(message.params, this.toolHandler)
        .then((result) => this.client.respond(message.id, result));
      return;
    }
    const event: CodexTransportEvent = "id" in message
      ? optionalParams({
        type: "server_request",
        requestId: message.id,
        method: message.method,
      }, message.params)
      : optionalParams({ type: "notification", method: message.method }, message.params);
    active.queue.push(event, { evictable: isEvictableNotification(message.method) });
    if (message.method === "turn/completed" && sourceThreadId === rootThreadId) {
      active.terminalReceived = true;
      active.queue.end();
    }
  }
}

function requireSessionId(session: CodexTransportSession, transport: string): string {
  if (session.transport !== transport || session.nativeSessionId === null) {
    throw new Error(`Session does not belong to ${transport}`);
  }
  return session.nativeSessionId;
}

function optionalParams<T extends object>(value: T, params: unknown): T & { params?: unknown } {
  return params === undefined ? value : { ...value, params };
}

function isEvictableNotification(method: string): boolean {
  return method.endsWith("/delta") || method.endsWith("/outputDelta");
}
