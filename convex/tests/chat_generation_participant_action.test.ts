import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { runGenerationParticipantHandler } from "../chat/actions_run_generation_participant_action";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

function baseRunGenerationParticipantArgs(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    generationJobIds: ["job_1" as any],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "msg_assistant" as any,
      jobId: "job_1" as any,
    } as any,
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    directToolNames: [],
    isPro: false,
    allowSubagents: false,
    resumeExpected: false,
    ...overrides,
  };
}

test("runGenerationParticipantHandler finalizes and clears state before rethrowing ConvexError", async () => {
  let jobStatus = "queued";
  const mutationCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return { status: jobStatus };
      }
      if ("modelId" in args) {
        // getModelCapabilities — return a non-video model so we stay on the
        // normal streaming path and hit the MISSING_API_KEY error.
        return { hasVideoGeneration: false };
      }
      if ("userId" in args) {
        return null;
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      if (args.jobId === "job_1" && args.status === "failed") {
        jobStatus = "failed";
      }
      return undefined;
    },
  });

  await assert.rejects(
    runGenerationParticipantHandler(ctx, baseRunGenerationParticipantArgs()),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "MISSING_API_KEY";
    },
  );

  assert.deepEqual(
    mutationCalls.filter((args) => Object.keys(args).length === 1 && args.jobId === "job_1"),
    [{ jobId: "job_1" }, { jobId: "job_1" }],
  );
  assert.ok(
    mutationCalls.some((args) =>
      args.messageId === "msg_assistant"
      && args.jobId === "job_1"
      && args.status === "failed"
      && typeof args.error === "string"
      && args.error.includes("\"code\":\"MISSING_API_KEY\"")
    ),
  );
});

test("runGenerationParticipantHandler exits when expected continuation cannot be claimed", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  let queryCount = 0;

  const ctx = createMockCtx({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return null;
    },
    runQuery: async () => {
      queryCount += 1;
      throw new Error("query should not be called after an unclaimed continuation");
    },
  });

  await runGenerationParticipantHandler(
    ctx,
    baseRunGenerationParticipantArgs({ resumeExpected: true }),
  );

  assert.deepEqual(mutationCalls, [{ jobId: "job_1" }]);
  assert.equal(queryCount, 0);
});

test("runGenerationParticipantHandler clears continuation for missing and terminal jobs", async () => {
  for (const job of [null, { status: "completed" }, { status: "cancelled" }, { status: "failed" }]) {
    const mutationCalls: Array<Record<string, unknown>> = [];
    const ctx = createMockCtx({
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        assert.deepEqual(args, { jobId: "job_1" });
        return job;
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutationCalls.push(args);
      },
    });

    await runGenerationParticipantHandler(ctx, baseRunGenerationParticipantArgs());

    assert.deepEqual(mutationCalls, [{ jobId: "job_1" }]);
  }
});

test("runGenerationParticipantHandler hands video-capable models to the video action", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return { status: "queued" };
      }
      if ("modelId" in args) {
        return { hasVideoGeneration: true };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_video";
      },
      runAt: async () => "unused",
    },
  });

  await runGenerationParticipantHandler(
    ctx,
    baseRunGenerationParticipantArgs({
      participant: {
        modelId: "google/veo-3",
        messageId: "msg_assistant" as any,
        jobId: "job_1" as any,
      },
      videoConfig: { prompt: "make a product demo" },
    }),
  );

  assert.deepEqual(mutationCalls, [{ jobId: "job_1" }]);
  assert.equal(scheduled.length, 1);
  assert.equal((scheduled[0]?.participant as any)?.modelId, "google/veo-3");
  assert.deepEqual(scheduled[0]?.videoConfig, { prompt: "make a product demo" });
});

test("runGenerationParticipantHandler finalizes video setup failure when scheduling fails", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const schedulingError = new Error("scheduler offline");
  let jobQueryCount = 0;

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return { hasVideoGeneration: true };
      }
      if ("jobId" in args) {
        jobQueryCount += 1;
        return { status: jobQueryCount === 1 ? "queued" : "failed" };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
    },
    scheduler: {
      runAfter: async () => {
        throw schedulingError;
      },
      runAt: async () => "unused",
    },
  });

  await assert.rejects(
    runGenerationParticipantHandler(
      ctx,
      baseRunGenerationParticipantArgs({
        participant: {
          modelId: "google/veo-3",
          messageId: "msg_assistant" as any,
          jobId: "job_1" as any,
        },
      }),
    ),
    schedulingError,
  );

  assert.ok(mutationCalls.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
    && args.error === "scheduler offline"
  ));
  assert.ok(mutationCalls.some((args) => args.jobId === "job_1"));
});
