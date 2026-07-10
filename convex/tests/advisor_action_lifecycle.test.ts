import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { internal } from "../_generated/api";
import { runAdvisor } from "../advisors/actions";
import { OpenRouterTransportCancelledError } from "../lib/openrouter_cancellation";

const runAdvisorHandler = (runAdvisor as unknown as {
  _handler: (ctx: unknown, args: { runId: string }) => Promise<null>;
})._handler;

test("Advisor context lookup failures terminalize a claimed run", async () => {
  const finalized: Array<Record<string, unknown>> = [];
  const names = {
    claim: getFunctionName(internal.advisors.mutations_internal.claimRun),
    context: getFunctionName(internal.advisors.queries.getRunExecutionContext),
    current: getFunctionName(internal.advisors.queries.getRunInternal),
    batch: getFunctionName(internal.advisors.queries.getBatchInternal),
    finalize: getFunctionName(internal.advisors.mutations_internal.finalizeRun),
  };
  await runAdvisorHandler({
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === names.claim) return true;
      if (name === names.finalize) {
        finalized.push(args);
        return { changed: true };
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === names.context) throw new Error("context limit exceeded");
      if (name === names.current) {
        return {
          _id: "run_1",
          batchId: "batch_1",
          personaId: "persona_1",
          requestedModelId: "model_1",
          allowWebSearch: false,
          status: "preparing_context",
        };
      }
      if (name === names.batch) {
        return { _id: "batch_1", userId: "user_1", chatId: "chat_1" };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    scheduler: { runAfter: async () => "analytics_1" },
  }, { runId: "run_1" });

  assert.deepEqual(finalized, [{
    runId: "run_1",
    status: "failed",
    errorCode: "ADVISOR_FAILED",
    errorMessage: "context limit exceeded",
  }]);
});

test("Advisor action strips SDK request dumps before finalization", async () => {
  const finalized: Array<Record<string, unknown>> = [];
  const names = {
    claim: getFunctionName(internal.advisors.mutations_internal.claimRun),
    context: getFunctionName(internal.advisors.queries.getRunExecutionContext),
    current: getFunctionName(internal.advisors.queries.getRunInternal),
    batch: getFunctionName(internal.advisors.queries.getBatchInternal),
    finalize: getFunctionName(internal.advisors.mutations_internal.finalizeRun),
  };
  const diagnostic = "ChatSend failed: " + JSON.stringify({
    name: "SDKValidationError",
    cause: { name: "ZodError", message: "Invalid tool message" },
    rawValue: {
      chatRequest: { messages: [{ content: "PRIVATE_PROMPT_SENTINEL" }] },
    },
  });

  await runAdvisorHandler({
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === names.claim) return true;
      if (name === names.finalize) {
        finalized.push(args);
        return { changed: true };
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === names.context) throw new Error(diagnostic);
      if (name === names.current) {
        return {
          _id: "run_1",
          batchId: "batch_1",
          personaId: "persona_1",
          requestedModelId: "model_1",
          allowWebSearch: false,
          status: "preparing_context",
        };
      }
      if (name === names.batch) {
        return { _id: "batch_1", userId: "user_1", chatId: "chat_1" };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    scheduler: { runAfter: async () => "analytics_1" },
  }, { runId: "run_1" });

  assert.equal(finalized[0]?.errorMessage, "Advisor consultation failed.");
  assert.doesNotMatch(
    String(finalized[0]?.errorMessage),
    /SDKValidationError|ZodError|rawValue|chatRequest|PRIVATE_PROMPT_SENTINEL/,
  );
});

test("late Advisor transport cancellation does not finalize or emit analytics twice", async () => {
  const mutations: string[] = [];
  const scheduled: unknown[] = [];
  const names = {
    claim: getFunctionName(internal.advisors.mutations_internal.claimRun),
    context: getFunctionName(internal.advisors.queries.getRunExecutionContext),
    current: getFunctionName(internal.advisors.queries.getRunInternal),
  };

  await runAdvisorHandler({
    runMutation: async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      mutations.push(name);
      if (name === names.claim) return true;
      throw new Error(`Unexpected mutation ${name}`);
    },
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === names.context) throw new OpenRouterTransportCancelledError();
      if (name === names.current) {
        return {
          _id: "run_1",
          status: "cancelled",
        };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  }, { runId: "run_1" });

  assert.deepEqual(mutations, [names.claim]);
  assert.deepEqual(scheduled, []);
});
