import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import {
  callOpenRouterAdvisorResponses,
  createOpenRouterResponsesDepsForTest,
} from "../lib/openrouter_responses";
import { isOpenRouterTransportCancelledError } from "../lib/openrouter_cancellation";

test("Advisor Responses transport enforces an absolute deadline independently of idle activity", async () => {
  const deps = createOpenRouterResponsesDepsForTest({
    fetch: ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    })) as typeof fetch,
  });

  await assert.rejects(
    callOpenRouterAdvisorResponses("test-key", {
      dispatcherModel: "openai/gpt-4.1-mini",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Question" }],
      }],
      instanceName: "persona_1",
      advisorModel: "anthropic/claude-sonnet-4",
      advisorInstructions: "Advise.",
      allowWebSearch: false,
      maxCompletionTokens: 100,
      idleTimeoutMs: 1_000,
      absoluteTimeoutMs: 5,
    }, {}, deps),
    (error: unknown) =>
      error instanceof ConvexError &&
      error.data?.code === "ADVISOR_TIMEOUT" &&
      /absolute/.test(error.data.message),
  );
});

test("Advisor Responses transport aborts a blocked request when durable state is cancelled", async () => {
  let cancellationChecks = 0;
  let transportStarted = false;
  let transportAborted = false;
  const deps = createOpenRouterResponsesDepsForTest({
    fetch: ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      transportStarted = true;
      const abort = () => {
        transportAborted = true;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    })) as typeof fetch,
  });

  await assert.rejects(
    callOpenRouterAdvisorResponses("test-key", {
      dispatcherModel: "openai/gpt-4.1-mini",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Question" }],
      }],
      instanceName: "persona_1",
      advisorModel: "anthropic/claude-sonnet-4",
      advisorInstructions: "Advise.",
      allowWebSearch: false,
      maxCompletionTokens: 100,
      idleTimeoutMs: 1_000,
      absoluteTimeoutMs: 1_000,
      cancellationPollIntervalMs: 1,
      isCancelled: async () => {
        cancellationChecks += 1;
        return cancellationChecks >= 2;
      },
    }, {}, deps),
    isOpenRouterTransportCancelledError,
  );
  assert.equal(transportStarted, true);
  assert.equal(transportAborted, true);
  assert.ok(cancellationChecks >= 2);
});
