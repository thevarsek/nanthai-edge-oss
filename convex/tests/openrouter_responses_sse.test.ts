import assert from "node:assert/strict";
import test from "node:test";
import { processAdvisorSSEText } from "../lib/openrouter_responses_sse";
import { GENERIC_ADVISOR_FAILURE } from "../lib/openrouter_responses_error";

function event(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

test("Responses SSE streams only the tracked Advisor item and preserves it for replay", async () => {
  const deltas: string[] = [];
  const stream = [
    ": keepalive\n\n",
    event("response.created", { response: { id: "resp_1" } }),
    event("response.output_item.added", {
      item: { id: "advisor_1", type: "openrouter:advisor", instance_name: "persona_1" },
    }),
    event("response.output_item.added", {
      item: { id: "message_1", type: "message" },
    }),
    event("response.output_text.delta", { item_id: "message_1", delta: "ignore" }),
    event("response.output_text.delta", { item_id: "advisor_1", delta: "Use " }),
    event("response.content_part.delta", {
      item_id: "advisor_1",
      delta: { type: "output_text_delta", text: "queues." },
    }),
    event("response.output_item.done", {
      item: {
        id: "advisor_1",
        type: "openrouter:advisor",
        status: "ok",
        instance_name: "persona_1",
        model: "anthropic/claude-sonnet-4",
        advice: "Use queues.",
      },
    }),
    event("response.completed", {
      response: {
        id: "resp_1",
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, cost: 0.02 },
      },
    }),
    "data: [DONE]\n\n",
  ].join("");

  const state = await processAdvisorSSEText(stream, {
    onAdviceDelta: async (delta) => { deltas.push(delta); },
  });
  assert.deepEqual(deltas, ["Use ", "queues."]);
  assert.equal(state.advice, "Use queues.");
  assert.equal(state.responseId, "resp_1");
  assert.equal(state.completedItem?.instance_name, "persona_1");
  assert.equal(state.completedItem?.model, "anthropic/claude-sonnet-4");
  assert.deepEqual(state.usage, {
    promptTokens: 10,
    completionTokens: 4,
    totalTokens: 14,
    cost: 0.02,
  });
  assert.equal(state.terminal, true);
});

test("Responses SSE surfaces a structured mid-stream failure", async () => {
  const state = await processAdvisorSSEText([
    event("response.created", { response: { id: "resp_failed" } }),
    event("response.failed", {
      error: { code: "provider_error", message: "Advisor provider unavailable" },
    }),
  ].join(""));
  assert.equal(state.terminal, true);
  assert.match(state.error ?? "", /Advisor provider unavailable/);
});

test("Responses SSE surfaces a top-level error even when the event omits a type", async () => {
  const state = await processAdvisorSSEText([
    event("response.created", { response: { id: "resp_failed" } }),
    `data: ${JSON.stringify({
      error: { code: "server_error", message: "Provider disconnected" },
    })}\n\n`,
  ].join(""));
  assert.equal(state.terminal, true);
  assert.match(state.error ?? "", /Provider disconnected/);
});

test("Advisor SDK failures never survive the completed-response overwrite path", async () => {
  const diagnostic = "Advisor call failed: chatSend failed: " + JSON.stringify({
    name: "SDKValidationError",
    cause: {
      name: "ZodError",
      message: "Invalid tool message without toolCallId",
    },
    rawValue: {
      chatRequest: {
        messages: [{ content: "PRIVATE_PROMPT_SENTINEL" }],
      },
    },
  });
  const item = {
    id: "advisor_failed",
    type: "openrouter:advisor",
    instance_name: "persona_1",
    error: diagnostic,
  };
  const state = await processAdvisorSSEText([
    event("response.output_item.added", { item }),
    event("response.output_item.done", { item }),
    event("response.completed", {
      response: { id: "resp_failed", output: [item] },
    }),
  ].join(""));

  assert.equal(state.error, GENERIC_ADVISOR_FAILURE);
  assert.doesNotMatch(
    state.error ?? "",
    /SDKValidationError|ZodError|rawValue|chatRequest|PRIVATE_PROMPT_SENTINEL/,
  );
});
