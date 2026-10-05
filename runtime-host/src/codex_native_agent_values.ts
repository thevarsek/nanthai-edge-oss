import { asRecord, stringAt, textChunks } from "./codex_event_items.ts";
import type { AdapterEvent } from "./protocol.ts";

export type NativeAgentStatus = Extract<
  AdapterEvent,
  { type: "native_agent_status" }
>["status"];

export type NativeAgentState = {
  nativeThreadId: string;
  parentNativeThreadId: string | null;
  depth: number;
  agentPath: string | null;
  nickname: string | null;
  role: string | null;
  prompt: string | null;
  reasoningEffort: string | null;
  provider: string | null;
  actualModel: string | null;
  started: boolean;
};

export function observedAgentState(
  nativeThreadId: string,
  parentNativeThreadId: string,
  depth: number,
  agentPath: string | null,
): NativeAgentState {
  return {
    nativeThreadId,
    parentNativeThreadId,
    depth: boundedDepth(depth),
    agentPath: boundedNullable(agentPath, 512),
    nickname: null,
    role: null,
    prompt: null,
    reasoningEffort: null,
    provider: null,
    actualModel: null,
    started: false,
  };
}

export function spawnSource(
  thread: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const source = asRecord(thread?.source);
  const subAgent = asRecord(source?.subAgent) ?? asRecord(source?.subagent);
  return asRecord(subAgent?.threadSpawn) ?? asRecord(subAgent?.thread_spawn);
}

export function actualModel(state: NativeAgentState) {
  return state.actualModel === null ? null : {
    provider: state.provider,
    modelId: state.actualModel,
    reportedByAdapter: true as const,
  };
}

export function mapThreadStatus(
  status: Record<string, unknown> | null,
): NativeAgentStatus | null {
  const type = stringAt(status, "type");
  if (type === "notLoaded") return "pending";
  if (type === "active") return "running";
  if (type === "systemError") return "failed";
  return null;
}

export function mapCollabStatus(status: string | null): NativeAgentStatus | null {
  if (status === "pendingInit") return "pending";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "errored") return "failed";
  if (status === "interrupted") return "interrupted";
  if (status === "shutdown") return "shutdown";
  if (status === "notFound") return "not_found";
  return null;
}

export function itemSummary(
  item: Record<string, unknown> | null,
  started: boolean,
): string {
  const type = stringAt(item, "type") ?? "tool";
  if (type === "commandExecution") {
    return bounded(
      stringAt(item, "command") ?? (started ? "Command started" : "Command completed"),
      2_000,
    );
  }
  if (type === "mcpToolCall") {
    const tool = stringAt(item, "tool") ?? "MCP tool";
    return bounded(`${tool} ${started ? "started" : "completed"}`, 2_000);
  }
  if (type === "webSearch") return started ? "Web search started" : "Web search completed";
  if (type === "fileChange") return "Agent reported file changes";
  return bounded(`Agent ${type} ${started ? "started" : "completed"}`, 2_000);
}

export function boundedDepth(value: number): number {
  return Math.max(1, Math.min(64, Math.trunc(value)));
}

export function boundedNullable(
  value: string | null | undefined,
  maximum: number,
): string | null {
  return value === null || value === undefined || value.length === 0
    ? null : bounded(value, maximum);
}

export function bounded(value: string, maximum: number): string {
  return textChunks(value, maximum)[0] ?? value.slice(0, maximum);
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
      .map((entry) => bounded(entry, 256))
    : [];
}
