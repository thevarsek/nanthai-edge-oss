import { asRecord, numberAt, stringAt, textChunks } from "./codex_event_items.ts";
import type { EventCreator } from "./codex_event_items.ts";
import {
  actualModel,
  bounded,
  boundedDepth,
  boundedNullable,
  itemSummary,
  mapCollabStatus,
  mapThreadStatus,
  observedAgentState,
  spawnSource,
  stringArray,
  type NativeAgentState,
  type NativeAgentStatus,
} from "./codex_native_agent_values.ts";
import type { AdapterEvent } from "./protocol.ts";
import { codexUsageEvents } from "./codex_usage_events.ts";

type ActivityKind = Extract<AdapterEvent, { type: "native_agent_activity" }>["kind"];

export class CodexNativeAgentNormalizer {
  private readonly agents = new Map<string, NativeAgentState>();
  private readonly streamedItems = new Set<string>();
  constructor(
    private readonly rootNativeThreadId: string,
    private readonly create: EventCreator,
  ) {}
  ownsThread(threadId: string): boolean {
    return threadId === this.rootNativeThreadId || this.agents.has(threadId);
  }
  isChildThread(threadId: string): boolean {
    return this.agents.has(threadId);
  }
  requestChildThreadId(params: unknown): string | null {
    const threadId = stringAt(asRecord(params), "threadId");
    return threadId !== null && this.isChildThread(threadId) ? threadId : null;
  }

  normalize(method: string, params: unknown): AdapterEvent[] | null {
    const record = asRecord(params);
    if (method === "thread/started") return this.threadStarted(record);
    const threadId = stringAt(record, "threadId");
    const item = asRecord(record?.item);
    if ((method === "item/started" || method === "item/completed")
      && this.isNativeAgentItem(item)) {
      return this.collaborationItem(item, method === "item/completed", threadId);
    }
    if (threadId === null || threadId === this.rootNativeThreadId) return null;
    const state = this.agents.get(threadId);
    if (!state) return null;
    if (method === "turn/started") {
      return this.withStarted(threadId, () => [this.status(threadId, "running", null)]);
    }
    if (method === "turn/completed") return this.childTurnCompleted(threadId, record);
    if (method === "thread/status/changed") return this.threadStatus(threadId, record);
    if (method === "item/agentMessage/delta") {
      return this.delta(threadId, record, "message");
    }
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      return this.delta(threadId, record, "reasoning");
    }
    if (method === "item/commandExecution/outputDelta") {
      return this.delta(threadId, record, "tool");
    }
    if (method === "item/started") return this.childItemStarted(threadId, item);
    if (method === "item/completed") return this.childItemCompleted(threadId, item);
    if (method === "model/rerouted") return this.childModelRerouted(threadId, record);
    if (method === "turn/diff/updated") {
      return this.activity(threadId, "diff", "tool", "Agent reported a diff");
    }
    if (method === "thread/tokenUsage/updated") return this.withStarted(threadId,
      () => codexUsageEvents(record, actualModel(state), this.create, threadId));
    if (method === "serverRequest/resolved"
      || method === "mcpServer/startupStatus/updated") return [];
    throw new Error(`Unsupported child App Server notification: ${method}`);
  }

  private threadStarted(record: Record<string, unknown> | null): AdapterEvent[] | null {
    const thread = asRecord(record?.thread);
    const threadId = stringAt(thread, "id");
    const parentThreadId = stringAt(thread, "parentThreadId");
    if (threadId === null || parentThreadId === null || !this.ownsThread(parentThreadId)) return null;
    const spawn = spawnSource(thread);
    const existing = this.agents.get(threadId);
    const parent = this.agents.get(parentThreadId);
    const state: NativeAgentState = {
      nativeThreadId: threadId,
      parentNativeThreadId: parentThreadId,
      depth: boundedDepth(numberAt(spawn, "depth") ?? (parent?.depth ?? 0) + 1),
      agentPath: boundedNullable(stringAt(spawn, "agentPath")
        ?? stringAt(spawn, "agent_path") ?? existing?.agentPath, 512),
      nickname: boundedNullable(stringAt(thread, "agentNickname")
        ?? stringAt(spawn, "agentNickname")
        ?? stringAt(spawn, "agent_nickname") ?? existing?.nickname, 512),
      role: boundedNullable(stringAt(thread, "agentRole")
        ?? stringAt(spawn, "agentRole")
        ?? stringAt(spawn, "agent_role") ?? existing?.role, 512),
      prompt: existing?.prompt ?? null,
      reasoningEffort: existing?.reasoningEffort ?? null,
      provider: boundedNullable(stringAt(thread, "modelProvider"), 256),
      actualModel: existing?.actualModel ?? null,
      started: existing?.started ?? false,
    };
    this.agents.set(threadId, state);
    const events = this.ensureStarted(state, existing?.started === true);
    const status = mapThreadStatus(asRecord(thread?.status));
    if (status !== null) events.push(this.status(threadId, status, null));
    return events;
  }

  private collaborationItem(
    item: Record<string, unknown>, completed: boolean, envelopeThreadId: string | null,
  ): AdapterEvent[] {
    if (stringAt(item, "type") === "subAgentActivity") {
      return this.subAgentActivity(item, envelopeThreadId);
    }
    const sender = stringAt(item, "senderThreadId");
    const receivers = stringArray(item.receiverThreadIds);
    if (sender === null || !this.ownsThread(sender)) return [];
    const prompt = boundedNullable(stringAt(item, "prompt"), 4_000);
    const reasoningEffort = boundedNullable(stringAt(item, "reasoningEffort"), 512);
    for (const threadId of receivers) {
      const existing = this.agents.get(threadId);
      this.agents.set(threadId, {
        nativeThreadId: threadId,
        parentNativeThreadId: existing?.parentNativeThreadId ?? sender,
        depth: existing?.depth ?? boundedDepth((this.agents.get(sender)?.depth ?? 0) + 1),
        agentPath: existing?.agentPath ?? null,
        nickname: existing?.nickname ?? null,
        role: existing?.role ?? null,
        prompt: prompt ?? existing?.prompt ?? null,
        reasoningEffort: reasoningEffort ?? existing?.reasoningEffort ?? null,
        provider: existing?.provider ?? null,
        actualModel: boundedNullable(stringAt(item, "model"), 256)
          ?? existing?.actualModel ?? null,
        started: existing?.started ?? false,
      });
    }
    const events: AdapterEvent[] = [];
    if (prompt !== null && stringAt(item, "tool") !== "spawnAgent") {
      for (const threadId of receivers.filter((id) => this.agents.has(id))) {
        events.push(...this.withStarted(threadId, () => []));
        events.push(...this.activity(
          threadId, stringAt(item, "id") ?? "delegation", "delegation", prompt,
        ));
      }
    }
    if (!completed) return events;
    const states = asRecord(item.agentsStates);
    for (const [threadId, value] of Object.entries(states ?? {})) {
      if (!this.agents.has(threadId)) continue;
      events.push(...this.withStarted(threadId, () => []));
      const state = asRecord(value);
      const status = mapCollabStatus(stringAt(state, "status"));
      if (status !== null) events.push(this.status(threadId, status, stringAt(state, "message")));
    }
    return events;
  }

  private subAgentActivity(
    item: Record<string, unknown>, parentThreadId: string | null,
  ): AdapterEvent[] {
    const threadId = stringAt(item, "agentThreadId");
    if (threadId === null || parentThreadId === null || !this.ownsThread(parentThreadId)) return [];
    let existing = this.agents.get(threadId);
    if (existing === undefined) {
      existing = observedAgentState(threadId, parentThreadId,
        (this.agents.get(parentThreadId)?.depth ?? 0) + 1, stringAt(item, "agentPath"));
      this.agents.set(threadId, existing);
    }
    existing.agentPath = boundedNullable(stringAt(item, "agentPath"), 512) ?? existing.agentPath;
    const kind = stringAt(item, "kind");
    const events = this.withStarted(threadId, () => []);
    if (kind === "interrupted") events.push(this.status(threadId, "interrupted", null));
    else if (kind === "started") events.push(this.status(threadId, "running", null));
    else if (kind === "interacted") {
      events.push(...this.activity(threadId, stringAt(item, "id") ?? "interaction",
        "interaction", "Agent interacted with its parent"));
    }
    return events;
  }

  private childTurnCompleted(
    threadId: string,
    record: Record<string, unknown> | null,
  ): AdapterEvent[] {
    const turn = asRecord(record?.turn);
    const status = stringAt(turn, "status");
    const mapped: NativeAgentStatus = status === "failed" ? "failed"
      : status === "interrupted" ? "interrupted" : "completed";
    const error = asRecord(turn?.error);
    return this.withStarted(threadId,
      () => [this.status(threadId, mapped, stringAt(error, "message"))]);
  }

  private threadStatus(threadId: string, record: Record<string, unknown> | null): AdapterEvent[] {
    const mapped = mapThreadStatus(asRecord(record?.status));
    return mapped === null ? []
      : this.withStarted(threadId, () => [this.status(threadId, mapped, null)]);
  }

  private childModelRerouted(threadId: string, record: Record<string, unknown> | null): AdapterEvent[] {
    const state = this.agents.get(threadId);
    const model = boundedNullable(stringAt(record, "toModel"), 256);
    if (state === undefined || model === null) return [];
    state.actualModel = model;
    return this.withStarted(threadId,
      () => [this.status(threadId, "running", "Agent model rerouted")]);
  }

  private childItemStarted(threadId: string, item: Record<string, unknown> | null): AdapterEvent[] {
    const id = stringAt(item, "id");
    const type = stringAt(item, "type");
    if (id === null || type === null || ["agentMessage", "reasoning"].includes(type)) return [];
    return this.activity(threadId, id, "tool", itemSummary(item, true));
  }

  private childItemCompleted(threadId: string, item: Record<string, unknown> | null): AdapterEvent[] {
    const id = stringAt(item, "id");
    const type = stringAt(item, "type");
    if (item === null || id === null || type === null) return [];
    if (type === "agentMessage" || type === "reasoning") {
      const kind = type === "agentMessage" ? "message" : "reasoning";
      if (this.streamedItems.has(`${threadId}:${kind}:${id}`)) return [];
      const text = type === "agentMessage" ? stringAt(item, "text") : stringArray(item.summary).join("\n");
      return this.activity(threadId, id, kind, text);
    }
    if (type === "collabAgentToolCall" || type === "subAgentActivity") {
      return this.collaborationItem(item, true, threadId);
    }
    return this.activity(threadId, id, "tool", itemSummary(item, false));
  }

  private delta(
    threadId: string,
    record: Record<string, unknown> | null,
    kind: "message" | "reasoning" | "tool",
  ): AdapterEvent[] {
    const id = stringAt(record, "itemId") ?? `${threadId}-${kind}`;
    const delta = stringAt(record, "delta");
    if (delta !== null && delta.length > 0) this.streamedItems.add(`${threadId}:${kind}:${id}`);
    return this.activity(threadId, id, kind, delta);
  }

  private activity(
    threadId: string,
    activityId: string,
    kind: ActivityKind,
    summary: string | null,
  ): AdapterEvent[] {
    return textChunks(summary, 2_000).map((chunk) => this.create({
      type: "native_agent_activity",
      nativeThreadId: threadId,
      activityId: bounded(activityId, 256),
      kind,
      summary: chunk,
    }));
  }

  private withStarted(threadId: string, events: () => AdapterEvent[]): AdapterEvent[] {
    const state = this.agents.get(threadId);
    return state === undefined ? events() : [...this.ensureStarted(state), ...events()];
  }

  private ensureStarted(state: NativeAgentState, repeat = false): AdapterEvent[] {
    if (state.started && !repeat) return [];
    state.started = true;
    return [this.create({
      type: "native_agent_started",
      nativeThreadId: state.nativeThreadId,
      rootNativeThreadId: this.rootNativeThreadId,
      parentNativeThreadId: state.parentNativeThreadId,
      depth: state.depth,
      agentPath: state.agentPath,
      nickname: state.nickname,
      role: state.role,
      prompt: state.prompt,
      actualModel: actualModel(state),
      reasoningEffort: state.reasoningEffort,
    })];
  }

  private status(threadId: string, status: NativeAgentStatus, summary: string | null): AdapterEvent {
    const state = this.agents.get(threadId);
    return this.create({
      type: "native_agent_status",
      nativeThreadId: threadId,
      status,
      summary: boundedNullable(summary, 2_000),
      actualModel: state === undefined ? null : actualModel(state),
      reasoningEffort: state?.reasoningEffort ?? null,
    });
  }

  private isNativeAgentItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    const type = stringAt(item, "type");
    return type === "collabAgentToolCall" || type === "subAgentActivity";
  }
}
