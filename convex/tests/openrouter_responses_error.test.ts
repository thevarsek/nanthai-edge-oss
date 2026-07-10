import assert from "node:assert/strict";
import test from "node:test";
import {
  conciseAdvisorFailure,
  GENERIC_ADVISOR_FAILURE,
} from "../lib/openrouter_responses_error";

test("Advisor errors fail closed for request objects without a canonical message", () => {
  for (const diagnostic of [
    'Advisor failed: {"request":{"content":"PRIVATE_REQUEST_SENTINEL"}}',
    'Advisor failed 🔒: [{"input":"PRIVATE_INPUT_SENTINEL"}]',
  ]) {
    const message = conciseAdvisorFailure(diagnostic);
    assert.equal(message, GENERIC_ADVISOR_FAILURE);
    assert.doesNotMatch(message, /PRIVATE_(?:REQUEST|INPUT)_SENTINEL/);
  }
});

test("Advisor errors preserve canonical provider messages from prefixed JSON", () => {
  assert.equal(
    conciseAdvisorFailure(
      'Error: {"code":"RATE_LIMIT","message":"Try again shortly"}',
    ),
    "Try again shortly",
  );
});

test("Advisor errors preserve safe messages while discarding diagnostic siblings", () => {
  assert.equal(conciseAdvisorFailure({
    error: {
      message: "Provider capacity is temporarily unavailable",
      metadata: {
        input: "temperature",
        rawValue: { request: "PRIVATE_PROVIDER_SENTINEL" },
      },
    },
  }), "Provider capacity is temporarily unavailable");

  assert.equal(conciseAdvisorFailure(
    "ChatSend failed: " + JSON.stringify({
      name: "SDKValidationError",
      rawMessage: "Input validation failed",
      rawValue: { chatRequest: { messages: ["PRIVATE_PROMPT_SENTINEL"] } },
    }),
  ), "Input validation failed");
});
