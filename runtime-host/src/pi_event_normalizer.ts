import { CanonicalEventFactory } from "./canonical_event_factory.ts";
import { asRecord, stringAt } from "./codex_event_items.ts";
import type { AdapterEvent, LocalRuntimeTurnPacket } from "./protocol.ts";
import type { PiRecord } from "./pi_rpc_client.ts";

export class PiEventNormalizer {
  readonly events: CanonicalEventFactory;
  outcome: "completed" | "failed" | "cancelled" = "completed";
  private messageNumber = 0;

  constructor(packet: LocalRuntimeTurnPacket, sessionId: string) {
    this.events = new CanonicalEventFactory(packet, sessionId);
  }

  normalize(record: PiRecord): AdapterEvent[] {
    const create = (fields: Record<string, unknown>) => this.events.create(fields);
    if (record.type === "message_start") {
      const message = asRecord(record.message);
      if (message?.role === "assistant") {
        this.messageNumber++;
        const provider = stringAt(message, "provider"), modelId = stringAt(message, "model");
        if (provider && modelId) return [create({ type: "model_observed",
          actualModel: { provider, modelId, reportedByAdapter: true }, reason: "reroute" })];
      }
    }
    if (record.type === "message_update") {
      const delta = asRecord(record.assistantMessageEvent);
      if (typeof delta?.delta !== "string") return [];
      if (delta.type === "text_delta") return chunks(delta.delta).map(text => create({
        type: "text_delta", messageId: `pi-message-${this.messageNumber}`, delta: text,
      }));
      if (delta.type === "thinking_delta") return chunks(delta.delta).map(text => create({ type: "reasoning_delta", delta: text }));
    }
    if (record.type === "tool_execution_start") return [create({
      type: "tool_started", toolCallId: record.toolCallId, toolName: record.toolName,
      summary: `${String(record.toolName)} started`.slice(0, 1000),
    })];
    if (record.type === "tool_execution_update") return [create({
      type: "tool_progress", toolCallId: record.toolCallId,
      summary: resultText(record.partialResult), progress: null,
    })];
    if (record.type === "tool_execution_end") return [create({
      type: "tool_completed", toolCallId: record.toolCallId, toolName: record.toolName,
      summary: resultText(record.result), outcome: record.isError ? "failed" : "completed", artifactIds: [],
    })];
    if (record.type === "message_end") {
      const message = asRecord(record.message);
      if (message?.role !== "assistant") return [];
      this.outcome = message.stopReason === "aborted" ? "cancelled"
        : message.stopReason === "error" ? "failed" : "completed";
      return this.usage(message.usage, message);
    }
    if (record.type === "compaction_end") {
      const result = asRecord(record.result);
      return result?.usage ? this.usage(result.usage, null) : [];
    }
    return [];
  }

  private usage(value: unknown, message: Record<string, unknown> | null): AdapterEvent[] {
    const usage = asRecord(value);
    if (!usage) return [];
    const cost = asRecord(usage.cost);
    const amount = count(cost?.total);
    const provider = stringAt(message, "provider");
    const modelId = stringAt(message, "model");
    const uncached = count(usage.input), read = count(usage.cacheRead), written = count(usage.cacheWrite);
    const input = uncached === null || read === null || written === null ? null : uncached + read + written;
    return [this.events.create({
      type: "usage_reported", actualModel: provider && modelId ? { provider, modelId, reportedByAdapter: true } : null,
      tokens: { input, output: count(usage.output), cachedInput: count(usage.cacheRead), reasoning: null, total: count(usage.totalTokens) },
      cost: amount === null ? { source: "unpriced", reason: "Pi did not report model pricing" }
        : { source: "api_equivalent_estimate", amount, currency: "USD", pricingVersion: "pi-model-catalog-1.0.0" },
    })];
  }
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function resultText(value: unknown): string {
  const content = asRecord(value)?.content;
  const text = Array.isArray(content) ? content.map(asRecord).filter(item => item?.type === "text")
    .map(item => String(item?.text ?? "")).join("\n") : "Pi tool updated";
  return text.slice(0, 1000) || "Pi tool completed";
}

function chunks(text: string): string[] {
  const values: string[] = [];
  for (let offset = 0; offset < text.length; offset += 32_000) values.push(text.slice(offset, offset + 32_000));
  return values;
}
