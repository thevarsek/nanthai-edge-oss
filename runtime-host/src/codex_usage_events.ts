import { asRecord, numberAt } from "./codex_event_items.ts";
import type { EventCreator } from "./codex_event_items.ts";
import type { AdapterEvent } from "./protocol.ts";

type ActualModel = Extract<AdapterEvent, { type: "usage_reported" }>["actualModel"];

export function codexUsageEvents(
  record: Record<string, unknown> | null,
  actualModel: ActualModel,
  create: EventCreator,
  nativeAgentThreadId?: string,
): AdapterEvent[] {
  const last = asRecord(asRecord(record?.tokenUsage)?.last);
  if (last === null) return [];
  return [create({
    type: "usage_reported",
    actualModel,
    ...(nativeAgentThreadId ? { nativeAgentThreadId } : {}),
    tokens: {
      input: numberAt(last, "inputTokens"),
      output: numberAt(last, "outputTokens"),
      cachedInput: numberAt(last, "cachedInputTokens"),
      reasoning: numberAt(last, "reasoningOutputTokens"),
      total: numberAt(last, "totalTokens"),
    },
    cost: { source: "unpriced", reason: "Codex did not report session cost" },
  })];
}
