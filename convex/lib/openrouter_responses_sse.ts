import { usageFromUnknown } from "./openrouter_extract";
import { conciseAdvisorFailure } from "./openrouter_responses_error";
import type {
  AdvisorOutputItem,
  AdvisorResponsesCallbacks,
  AdvisorSSEState,
} from "./openrouter_responses_types";
import type { OpenRouterUsage } from "./openrouter_types";

export function createAdvisorSSEState(): AdvisorSSEState {
  return {
    advisorItemIds: new Set<string>(),
    advice: "",
    usage: null,
    terminal: false,
  };
}

export async function processAdvisorSSEBody(
  body: ReadableStream<Uint8Array>,
  callbacks: AdvisorResponsesCallbacks,
): Promise<AdvisorSSEState> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = createAdvisorSSEState();
  let buffer = "";

  try {
    while (!state.terminal) {
      const { done, value } = await reader.read();
      if (done) break;
      callbacks.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const split = splitCompleteEvents(buffer);
      buffer = split.rest;
      for (const event of split.events) {
        await processAdvisorSSEEvent(event, state, callbacks);
        if (state.terminal) break;
      }
    }
    buffer += decoder.decode();
    if (!state.terminal && buffer.trim()) {
      await processAdvisorSSEEvent(buffer, state, callbacks);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return state;
}

export async function processAdvisorSSEText(
  text: string,
  callbacks: AdvisorResponsesCallbacks = {},
): Promise<AdvisorSSEState> {
  const state = createAdvisorSSEState();
  const split = splitCompleteEvents(`${text}\n\n`);
  for (const event of split.events) {
    await processAdvisorSSEEvent(event, state, callbacks);
    if (state.terminal) break;
  }
  return state;
}

export async function processAdvisorSSEEvent(
  rawEvent: string,
  state: AdvisorSSEState,
  callbacks: AdvisorResponsesCallbacks,
): Promise<void> {
  const parsedEvent = parseEvent(rawEvent);
  if (!parsedEvent.data) return;
  callbacks.onActivity?.();
  if (parsedEvent.data === "[DONE]") {
    state.terminal = true;
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(parsedEvent.data) as Record<string, unknown>;
  } catch {
    return;
  }

  const type = stringValue(payload.type) ?? parsedEvent.event;
  captureResponseId(payload, state);
  captureUsage(payload, state);
  const response = recordValue(payload.response);
  if (payload.error != null || response?.error != null) {
    state.error = conciseAdvisorFailure(payload.error ?? response?.error);
    state.terminal = true;
    return;
  }

  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const item = advisorItem(payload.item);
    if (item) {
      if (item.id) state.advisorItemIds.add(item.id);
      if (type === "response.output_item.done") {
        state.completedItem = item;
        if (typeof item.advice === "string") state.advice = item.advice;
        if (typeof item.error === "string" && item.error.trim()) {
          state.error = conciseAdvisorFailure(item.error);
        }
      }
    }
    return;
  }

  if (type === "response.output_text.delta" || type === "response.content_part.delta") {
    const itemId = stringValue(payload.item_id);
    const delta = deltaText(payload.delta);
    if (itemId && delta && state.advisorItemIds.has(itemId)) {
      state.advice += delta;
      await callbacks.onAdviceDelta?.(delta);
    }
    return;
  }

  if (type === "response.completed" || type === "response.done") {
    captureCompletedResponse(payload, state);
    state.terminal = true;
    return;
  }

  if (
    type === "response.failed" ||
    type === "response.incomplete" ||
    type === "response.error" ||
    type === "error"
  ) {
    state.error = conciseAdvisorFailure(payload);
    state.terminal = true;
  }
}

function splitCompleteEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  return { events: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

function parseEvent(raw: string): { event?: string; data?: string } {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.length > 0 ? data.join("\n") : undefined };
}

function captureCompletedResponse(payload: Record<string, unknown>, state: AdvisorSSEState): void {
  const response = recordValue(payload.response) ?? payload;
  captureResponseId(response, state);
  captureUsage(response, state);
  const output = Array.isArray(response.output) ? response.output : [];
  for (const rawItem of output) {
    const item = advisorItem(rawItem);
    if (!item) continue;
    if (item.id) state.advisorItemIds.add(item.id);
    state.completedItem = item;
    if (typeof item.advice === "string") state.advice = item.advice;
    if (typeof item.error === "string" && item.error.trim()) {
      state.error = conciseAdvisorFailure(item.error);
    }
    break;
  }
}

function captureResponseId(payload: Record<string, unknown>, state: AdvisorSSEState): void {
  const response = recordValue(payload.response);
  state.responseId ??= stringValue(response?.id) ?? stringValue(payload.response_id) ?? stringValue(payload.id);
}

function captureUsage(payload: Record<string, unknown>, state: AdvisorSSEState): void {
  const response = recordValue(payload.response);
  state.usage = responsesUsage(payload.usage) ?? responsesUsage(response?.usage) ?? state.usage;
}

function responsesUsage(value: unknown): OpenRouterUsage | null {
  const existing = usageFromUnknown(value);
  const usage = recordValue(value);
  if (!usage) return existing ?? null;
  const input = numberValue(usage.input_tokens);
  const output = numberValue(usage.output_tokens);
  const total = numberValue(usage.total_tokens);
  if (input == null && output == null && total == null) return existing ?? null;
  const result: OpenRouterUsage = {
    ...existing,
    promptTokens: input ?? existing?.promptTokens ?? 0,
    completionTokens: output ?? existing?.completionTokens ?? 0,
    totalTokens: total ?? existing?.totalTokens ?? (input ?? 0) + (output ?? 0),
  };
  const cost = numberValue(usage.cost);
  if (cost != null) result.cost = cost;
  return result;
}

function advisorItem(value: unknown): AdvisorOutputItem | undefined {
  const record = recordValue(value);
  return record?.type === "openrouter:advisor"
    ? record as AdvisorOutputItem
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function deltaText(value: unknown): string | undefined {
  if (typeof value === "string") return stringValue(value);
  const delta = recordValue(value);
  return stringValue(delta?.text) ?? stringValue(delta?.delta) ?? stringValue(delta?.content);
}
