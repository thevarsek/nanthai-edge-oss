import type { AdapterEvent } from "./protocol.ts";

export type EventCreator = (fields: Record<string, unknown>) => AdapterEvent;

export function startedItemEvents(item: unknown, create: EventCreator): AdapterEvent[] {
  const record = asRecord(item);
  const id = stringAt(record, "id");
  const type = stringAt(record, "type");
  if (id === null || type === null) return [];
  if (type === "command_execution" || type === "commandExecution") {
    return [create({
      type: "tool_started",
      toolCallId: id,
      toolName: "command",
      summary: bounded(stringAt(record, "command") ?? "Command started", 2_000),
    })];
  }
  if (type === "mcp_tool_call" || type === "mcpToolCall") {
    const server = stringAt(record, "server") ?? "mcp";
    const tool = stringAt(record, "tool") ?? stringAt(record, "toolName") ?? "tool";
    return [create({
      type: "tool_started",
      toolCallId: id,
      toolName: identifier(`${server}.${tool}`),
      summary: bounded(`Calling ${server}.${tool}`, 2_000),
    })];
  }
  if (type === "web_search" || type === "webSearch") {
    return [create({
      type: "tool_started",
      toolCallId: id,
      toolName: "web_search",
      summary: bounded(stringAt(record, "query") || "Web search started", 2_000),
    })];
  }
  return [];
}

export function completedItemEvents(
  item: unknown,
  create: EventCreator,
  streamedItemContent?: ReadonlySet<string>,
): AdapterEvent[] {
  const record = asRecord(item);
  const id = stringAt(record, "id");
  const type = stringAt(record, "type");
  if (id === null || type === null) return [];
  if (type === "agent_message" || type === "agentMessage") {
    if (streamedItemContent?.has(`text_delta:${id}`) === true) return [];
    return textChunks(stringAt(record, "text"), 32_000).map((delta) => create({
      type: "text_delta",
      messageId: id,
      delta,
    }));
  }
  if (type === "reasoning") {
    if (streamedItemContent?.has(`reasoning_delta:${id}`) === true) return [];
    const text = stringAt(record, "text") ?? stringArray(record?.summary).join("\n");
    return textChunks(text, 32_000).map((delta) => create({
      type: "reasoning_delta",
      delta,
    }));
  }
  if (type === "command_execution" || type === "commandExecution") {
    const output = stringAt(record, "aggregated_output")
      ?? stringAt(record, "aggregatedOutput");
    const events = textChunks(output, 64_000).map((chunk, index, chunks) => create({
      type: "command_output",
      toolCallId: id,
      stream: "stdout",
      chunk,
      isFinalChunk: index === chunks.length - 1,
    }));
    const status = stringAt(record, "status");
    const exitCode = numberAt(record, "exit_code") ?? numberAt(record, "exitCode");
    events.push(create({
      type: "tool_completed",
      toolCallId: id,
      toolName: "command",
      outcome: status === "failed" || (exitCode !== null && exitCode !== 0)
        ? "failed" : status === "cancelled" ? "cancelled" : "completed",
      summary: bounded(exitCode === null ? "Command finished" : `Command exited ${exitCode}`, 2_000),
      artifactIds: [],
    }));
    return events;
  }
  if (type === "file_change" || type === "fileChange") {
    return [create({
      type: "evidence_observed",
      evidenceKind: "file",
      summary: "Codex reported file changes",
      localPath: null,
      artifactIds: [],
    })];
  }
  if (["mcp_tool_call", "mcpToolCall", "web_search", "webSearch"].includes(type)) {
    const server = stringAt(record, "server") ?? "mcp";
    const tool = stringAt(record, "tool") ?? stringAt(record, "toolName")
      ?? (type.includes("web") ? "web_search" : "tool");
    const status = stringAt(record, "status");
    return [create({
      type: "tool_completed",
      toolCallId: id,
      toolName: identifier(type.includes("web") ? tool : `${server}.${tool}`),
      outcome: status === "failed" ? "failed" : "completed",
      summary: bounded(status === "failed" ? `${tool} failed` : `${tool} completed`, 2_000),
      artifactIds: [],
    })];
  }
  return [];
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function stringAt(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

export function numberAt(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function textChunks(value: string | null, maximum: number): string[] {
  if (value === null || value.length === 0) return [];
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (chunk.length + character.length > maximum && chunk.length > 0) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function identifier(value: string): string {
  return value.length <= 256 ? value : value.slice(0, 256);
}
