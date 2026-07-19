import assert from "node:assert/strict";
import test from "node:test";
import {
  callOpenRouterNonStreaming,
  createOpenRouterNonStreamingDepsForTest,
} from "../lib/openrouter_nonstream";
import {
  assertRetryDelayFits,
  createNonStreamingDeadline,
  nextAttemptTimeoutMs,
} from "../lib/openrouter_nonstream_deadline";

test("non-stream deadline caps each attempt to the remaining total budget", () => {
  const deadline = createNonStreamingDeadline({
    requestTimeoutMs: 5_000,
    totalTimeoutMs: 3_000,
  }, 0);

  assert.equal(nextAttemptTimeoutMs(deadline, 0), 3_000);
  assert.equal(nextAttemptTimeoutMs(deadline, 2_500), 500);
  assert.doesNotThrow(() => assertRetryDelayFits(deadline, 499, 2_500));
  assert.throws(
    () => assertRetryDelayFits(deadline, 500, 2_500),
    /total timeout after 3000ms/i,
  );
  assert.throws(() => nextAttemptTimeoutMs(deadline, 3_000), /total timeout/i);
});

test("non-stream deadline honors an earlier action-entry deadline", () => {
  const deadline = createNonStreamingDeadline({
    requestTimeoutMs: 5_000,
    totalTimeoutMs: 5_000,
    absoluteDeadlineAtMs: 1_500,
  }, 1_000);

  assert.equal(nextAttemptTimeoutMs(deadline, 1_000), 500);
  assert.throws(() => nextAttemptTimeoutMs(deadline, 1_500), /total timeout/i);
});

test("non-stream deadline stops a fallback after the primary consumes the total budget", async () => {
  let now = 0;
  let fetchCount = 0;
  const deps = createOpenRouterNonStreamingDepsForTest({
    now: () => now,
    fetch: async () => {
      fetchCount += 1;
      now = 1_000;
      return new Response(JSON.stringify({ error: { message: "primary failed" } }));
    },
  });

  await assert.rejects(
    () => callOpenRouterNonStreaming(
      "key",
      "primary-model",
      [{ role: "user", content: "hello" }],
      {},
      {
        fallbackModel: "fallback-model",
        requestTimeoutMs: 5_000,
        totalTimeoutMs: 1_000,
      },
      deps,
    ),
    /total timeout after 1000ms/i,
  );
  assert.equal(fetchCount, 1);
});
