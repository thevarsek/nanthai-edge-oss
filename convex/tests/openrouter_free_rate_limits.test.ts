import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { callOpenRouterNonStreaming, createOpenRouterNonStreamingDepsForTest } from "../lib/openrouter_nonstream";
import { callOpenRouterStreaming, createOpenRouterStreamingDepsForTest } from "../lib/openrouter_stream";
import { generationRecovery } from "../chat/generation_recovery";
import { MODEL_IDS } from "../lib/model_constants";

for (const streaming of [false, true]) {
  test(`${streaming ? "streaming" : "nonstreaming"} free daily limit respects retry hints and terminates without a credits recovery`, async () => {
    const delays: number[] = [];
    let calls = 0;
    const deps = {
      sleep: async (ms: number) => { delays.push(ms); },
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } } }), {
          status: 429, headers: { "Retry-After": "2", "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0" },
        });
      },
    };
    const args: [string, string, { role: "user"; content: string }[], Record<string, never>] = ["test-key", MODEL_IDS.freeDefault, [{ role: "user", content: "hello" }], {}];
    const call = streaming
      ? callOpenRouterStreaming(...args, {}, {}, createOpenRouterStreamingDepsForTest(deps))
      : callOpenRouterNonStreaming(...args, {}, createOpenRouterNonStreamingDepsForTest(deps));
    await assert.rejects(call, (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      assert.match(error.data.message, /request limit/i);
      assert.doesNotMatch(error.data.message, /credit|top.up/i);
      assert.equal(generationRecovery({ role: "assistant", status: "failed", content: JSON.stringify(error.data) }), undefined);
      return true;
    });
    assert.equal(calls, 4);
    assert.deepEqual(delays, [2000, 2000, 2000]);
  });
}
