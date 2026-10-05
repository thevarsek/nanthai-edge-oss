import { CanonicalEventFactory } from "./canonical_event_factory.ts";
import { codexTerminalResult } from "./codex_terminal_result.ts";
import { CodexAppServerWarningHandler } from "./codex_app_server_warning.ts";
import {
  asRecord,
  completedItemEvents,
  startedItemEvents,
  stringAt,
  textChunks,
} from "./codex_event_items.ts";
import { CodexNativeAgentNormalizer } from "./codex_native_agents.ts";
import { codexUsageEvents } from "./codex_usage_events.ts";
import {
  mapNativeInputResponse,
  mapNativePermissionResponse,
  normalizeNativeRequest,
  type PendingNativeRequest,
} from "./codex_request_mapping.ts";
import type {
  CodexTransportEvent,
  CodexTransportSession,
} from "./codex_transport.ts";
import type {
  AdapterEvent,
  LocalRuntimeTurnPacket,
  PermissionDecision,
  StructuredInput,
} from "./protocol.ts";
export class CodexEventNormalizer {
  private readonly factory: CanonicalEventFactory;
  private readonly warningHandler: CodexAppServerWarningHandler;
  private readonly nativeAgents: CodexNativeAgentNormalizer | null;
  private readonly pending = new Map<string, PendingNativeRequest & { nativeRequestId: string | number }>();
  private actualModel: { provider: string | null; modelId: string } | null = null;
  private readonly streamedItemContent = new Set<string>();
  private sessionStarted = false;
  private terminal = false;
  private cancelRequested = false;
  constructor(
    packet: LocalRuntimeTurnPacket,
    private readonly sessionId: string,
    private readonly session: CodexTransportSession,
    now: () => number = Date.now,
    onLocalWarning?: (message: string) => void,
  ) {
    this.factory = new CanonicalEventFactory(packet, sessionId, now);
    this.nativeAgents = session.transport === "app_server_stdio" && session.nativeSessionId !== null
      ? new CodexNativeAgentNormalizer(session.nativeSessionId, this.create) : null;
    this.warningHandler = new CodexAppServerWarningHandler(
      session.nativeSessionId, onLocalWarning,
      (threadId) => this.nativeAgents?.ownsThread(threadId) ?? false,
    );
    if (session.transport === "app_server_stdio" && session.model !== null) {
      this.actualModel = { provider: session.provider, modelId: session.model };
    }
  }
  initialEvents(resumed: boolean): AdapterEvent[] {
    if (this.session.nativeSessionId === null || this.sessionStarted) return [];
    this.sessionStarted = true;
    const events = [this.create({
      type: "session_started",
      nativeSessionId: this.session.nativeSessionId,
      resumed,
      workingDirectory: this.session.workingDirectory ?? process.cwd(),
      repository: null,
    })];
    if (this.actualModel !== null) {
      events.push(this.modelEvent(resumed ? "resume" : "initial"));
    }
    return events;
  }
  normalize(raw: CodexTransportEvent): AdapterEvent[] {
    if (this.terminal) return [];
    if (raw.type === "server_request") {
      this.pending.set(String(raw.requestId), {
        nativeRequestId: raw.requestId, method: raw.method, params: raw.params,
      });
      return [normalizeNativeRequest(raw.requestId, raw.method, raw.params, this.create,
        this.nativeAgents?.requestChildThreadId(raw.params) ?? null)];
    }
    return this.notification(raw.method, raw.params);
  }
  markCancelRequested(): void {
    this.cancelRequested = true;
  }
  permissionResolved(requestId: string | number, decision: PermissionDecision): AdapterEvent {
    this.pending.delete(String(requestId));
    return this.create({
      type: "permission_resolved",
      permissionRequestId: String(requestId),
      decision,
    });
  }
  inputResolved(
    requestId: string | number,
    outcome: "submitted" | "cancelled",
  ): AdapterEvent {
    this.pending.delete(String(requestId));
    return this.create({
      type: "input_resolved",
      inputRequestId: String(requestId),
      outcome,
    });
  }
  nativePermissionResponse(
    requestId: string | number,
    decision: PermissionDecision,
  ): unknown {
    const pending = this.requirePending(requestId);
    return mapNativePermissionResponse(pending, decision);
  }
  nativeInputResponse(
    requestId: string | number,
    response: { outcome: "submitted"; content: StructuredInput }
      | { outcome: "cancelled"; content: null },
  ): unknown {
    const pending = this.requirePending(requestId);
    return mapNativeInputResponse(pending, response);
  }
  nativeRequestId(requestId: string | number): string | number {
    return this.requirePending(requestId).nativeRequestId;
  }
  interrupted(): AdapterEvent[] {
    return this.terminalEvent("interrupted",
      "Codex transport interrupted before a terminal result", "worker_interrupted");
  }
  private notification(method: string, params: unknown): AdapterEvent[] {
    const record = asRecord(params);
    if (method === "warning") return this.warningHandler.consume(params);
    // Native hook execution is observational; errors and turn/completed own outcomes.
    // Do not publish hook output or configuration paths into canonical chat events.
    if (method === "hook/started" || method === "hook/completed") return [];
    // Naming is display metadata for either the root or a native child thread.
    if (method === "thread/name/updated") return [];
    // Native terminal input/polling is already applied by Codex. Output and item
    // completion remain authoritative; this observation is not a new action.
    if (method === "item/commandExecution/terminalInteraction") return [];
    if (method === "error") {
      const detail = stringAt(asRecord(record?.error), "message") ?? "Codex turn failed";
      if (record?.willRetry === true) return [];
      return this.terminalEvent("failed", detail.slice(0, 2_000), "codex_turn_failed",
        stringAt(record, "turnId"));
    }
    const nativeEvents = this.nativeAgents?.normalize(method, params);
    if (nativeEvents !== undefined && nativeEvents !== null) return nativeEvents;
    if (method === "mcpServer/startupStatus/updated" || method === "thread/status/changed"
      || method === "thread/started" || method === "serverRequest/resolved"
      || method === "thread/goal/cleared" || method === "thread/goal/updated") return [];
    if (method === "turn/started" || method === "item/started") {
      return method === "item/started" ? startedItemEvents(record?.item, this.create) : [];
    }
    if (method === "item/completed") return completedItemEvents(record?.item, this.create, this.streamedItemContent);
    if (method === "item/agentMessage/delta") {
      return this.deltaEvents("text_delta", record);
    }
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      return this.deltaEvents("reasoning_delta", record);
    }
    if (method === "item/commandExecution/outputDelta") {
      return textChunks(stringAt(record, "delta"), 64_000).map((chunk) => this.create({
        type: "command_output",
        toolCallId: stringAt(record, "itemId"),
        stream: "stdout",
        chunk,
        isFinalChunk: false,
      }));
    }
    if (method === "turn/diff/updated") {
      const diff = stringAt(record, "diff");
      if (diff === null || diff.length === 0) return [];
      return [this.create({
        type: "evidence_observed",
        evidenceKind: "diff",
        summary: `Codex reported a ${diff.length}-character diff`,
        localPath: null,
        artifactIds: [],
      })];
    }
    if (method === "thread/tokenUsage/updated") return this.usageEvents(record);
    if (method === "model/rerouted") return this.rerouteEvents(record);
    if (method === "turn/completed") return this.completedEvents(record);
    throw new Error(`Unsupported App Server notification: ${method}`);
  }
  private deltaEvents(
    type: "text_delta" | "reasoning_delta",
    record: Record<string, unknown> | null,
  ): AdapterEvent[] {
    const chunks = textChunks(stringAt(record, "delta"), 32_000);
    const itemId = stringAt(record, "itemId");
    if (chunks.length > 0 && itemId !== null) this.streamedItemContent.add(`${type}:${itemId}`);
    return chunks.map((delta) => this.create(
      type === "text_delta"
        ? { type, messageId: stringAt(record, "itemId") ?? `${this.sessionId}-message`, delta }
        : { type, delta },
    ));
  }
  private usageEvents(record: Record<string, unknown> | null): AdapterEvent[] {
    return codexUsageEvents(record, this.actualModel === null
      ? null : { ...this.actualModel, reportedByAdapter: true }, this.create);
  }
  private rerouteEvents(record: Record<string, unknown> | null): AdapterEvent[] {
    const modelId = stringAt(record, "toModel");
    if (modelId === null) return [];
    this.actualModel = { provider: this.session.provider, modelId };
    return [this.modelEvent("reroute")];
  }
  private completedEvents(record: Record<string, unknown> | null): AdapterEvent[] {
    return this.terminalEvent(...codexTerminalResult(record, this.cancelRequested));
  }
  private modelEvent(reason: "initial" | "reroute" | "resume"): AdapterEvent {
    if (this.actualModel === null) throw new Error("No adapter-reported model is available");
    return this.create({
      type: "model_observed",
      actualModel: { ...this.actualModel, reportedByAdapter: true },
      reason,
    });
  }
  private terminalEvent(
    outcome: "completed" | "failed" | "cancelled" | "interrupted",
    summary: string,
    errorCode: string | null,
    nativeTurnId: string | null = null,
  ): AdapterEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    return [this.create({
      type: "terminal",
      outcome,
      summary: summary.slice(0, 2_000),
      errorCode,
      checkpointRef: null,
      nativeTurnId,
    })];
  }
  private requirePending(id: string | number): PendingNativeRequest & { nativeRequestId: string | number } {
    const pending = this.pending.get(String(id));
    if (pending === undefined) throw new Error(`Unknown native request: ${id}`);
    return pending;
  }
  private readonly create = (fields: Record<string, unknown>) => this.factory.create(fields);
}
