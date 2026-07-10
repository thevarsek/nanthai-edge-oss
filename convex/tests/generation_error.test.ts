import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { normalizeGenerationError } from "../chat/generation_error";

test("normalizeGenerationError unwraps structured Convex errors", () => {
  const error = new ConvexError({
    code: "INTERNAL_ERROR",
    message: "OpenRouter API error (500): Internal Server Error",
  });

  assert.deepEqual(normalizeGenerationError(error), {
    code: "INTERNAL_ERROR",
    message: "OpenRouter API error (500): Internal Server Error",
  });
});

test("normalizeGenerationError parses legacy JSON strings and nested errors", () => {
  assert.deepEqual(normalizeGenerationError(new Error(
    'Error: {"code":"RATE_LIMIT","message":"Try again shortly"}',
  )), {
    code: "RATE_LIMIT",
    message: "Try again shortly",
  });
  assert.deepEqual(normalizeGenerationError({
    error: { error_type: "provider_unavailable", message: "Provider unavailable" },
  }), {
    code: "provider_unavailable",
    message: "Provider unavailable",
  });
});

test("normalizeGenerationError preserves unstructured fallbacks", () => {
  assert.equal(normalizeGenerationError("plain failure").message, "plain failure");
  assert.equal(
    normalizeGenerationError({ unexpected: true }).message,
    '{"unexpected":true}',
  );
  assert.equal(normalizeGenerationError(null).message, "Unknown generation error");
});
