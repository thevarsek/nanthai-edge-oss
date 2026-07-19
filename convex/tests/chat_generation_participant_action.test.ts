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
    [{ jobId: "job_1" }, { jobId: "job_1" }, { jobId: "job_1" }, { jobId: "job_1" }],
  );
  assert.ok(
    mutationCalls.some((args) =>
      args.messageId === "msg_assistant"
      && args.jobId === "job_1"
      && args.status === "failed"
      && typeof args.error === "string"
      && args.error.includes("No OpenRouter API key")
    ),
  );
});

test("runGenerationParticipantHandler fails when expected continuation cannot be claimed", async () => {
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

  await assert.rejects(
    runGenerationParticipantHandler(
      ctx,
      baseRunGenerationParticipantArgs({ resumeExpected: true }),
    ),
    /GENERATION_CONTINUATION_NOT_CLAIMABLE/,
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
  const analyticsSchedule = scheduled.find((payload) =>
    payload.event === "video_generation_requested"
  );
  assert.equal(analyticsSchedule?.distinctId, "user_1");
  assert.equal(analyticsSchedule?.event, "video_generation_requested");
  assert.equal((analyticsSchedule?.properties as any)?.chat_id, "chat_1");
  assert.equal((analyticsSchedule?.properties as any)?.message_id, "msg_assistant");
  assert.equal((analyticsSchedule?.properties as any)?.job_id, "job_1");
  assert.equal((analyticsSchedule?.properties as any)?.model_id, "google/veo-3");
  const videoSchedule = scheduled.find((payload) => "participant" in payload);
  assert.equal((videoSchedule?.participant as any)?.modelId, "google/veo-3");
  assert.deepEqual(videoSchedule?.videoConfig, { prompt: "make a product demo" });
});

test("runGenerationParticipantHandler schedules analytics without awaiting PostHog fetch", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectToken = process.env.POSTHOG_PROJECT_TOKEN;
  let fetchCalls = 0;
  const scheduled: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return await new Promise<Response>(() => {});
  }) as typeof fetch;
  process.env.POSTHOG_PROJECT_TOKEN = "phc_slow_test_token";

  try {
    const ctx = createMockCtx({
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("jobId" in args) {
          return { status: "queued" };
        }
        if ("modelId" in args) {
          return { hasVideoGeneration: false };
        }
        if ("userId" in args) {
          return null;
        }
        throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
      },
      runMutation: async () => undefined,
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
          scheduled.push(payload);
          return `scheduled_${scheduled.length}`;
        },
        runAt: async () => "unused",
      },
    });

    const result = await Promise.race([
      runGenerationParticipantHandler(ctx, baseRunGenerationParticipantArgs())
        .then(() => "resolved" as const)
        .catch((error: unknown) => error),
      new Promise<"timed_out">((resolve) => {
        setTimeout(() => resolve("timed_out"), 100);
      }),
    ]);

    assert.notEqual(result, "timed_out");
    assert.ok(result instanceof ConvexError);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(
      scheduled.map((payload) => payload.event),
      ["assistant_response_started", "assistant_response_failed"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProjectToken === undefined) {
      delete process.env.POSTHOG_PROJECT_TOKEN;
    } else {
      process.env.POSTHOG_PROJECT_TOKEN = originalProjectToken;
    }
  }
});

test("runGenerationParticipantHandler finalizes video setup failure when scheduling fails", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
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
      if (Object.keys(args).length === 1 && args.jobId === "job_1") {
        return true;
      }
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload?: Record<string, unknown>) => {
        if (payload && "participant" in payload) {
          throw schedulingError;
        }
        if (payload) scheduled.push(payload);
        return "scheduled_analytics";
      },
      runAt: async () => {
        throw schedulingError;
      },
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
  assert.deepEqual(
    scheduled
      .filter((payload) =>
        payload.event === "assistant_response_started" ||
        payload.event === "assistant_response_failed"
      )
      .map((payload) => payload.event),
    ["assistant_response_started", "assistant_response_failed"],
  );
});

test("runGenerationParticipantHandler finalizes subagent and Drive picker batches after setup failure", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const jobStatuses = ["queued", "streaming", "failed", "failed", "timedOut"];
  const messageStatuses = ["cancelled", "completed"];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return { status: jobStatuses.shift() ?? "failed" };
      }
      if ("messageId" in args) {
        return { status: messageStatuses.shift() ?? "completed" };
      }
      if ("modelId" in args) {
        return { hasVideoGeneration: false };
      }
      if ("userId" in args) {
        return null;
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return undefined;
    },
  });

  await assert.rejects(
    runGenerationParticipantHandler(
      ctx,
      baseRunGenerationParticipantArgs({
        subagentBatchId: "batch_subagents",
        drivePickerBatchId: "batch_drive",
        searchSessionId: "search_1",
      }),
    ),
    (error: unknown) => error instanceof ConvexError,
  );

  assert.ok(mutationCalls.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
  ));
  assert.ok(mutationCalls.some((args) =>
    args.batchId === "batch_subagents"
    && args.status === "cancelled"
    && args.expectedCurrentStatus === "resuming"
  ));
  assert.ok(mutationCalls.some((args) =>
    args.batchId === "batch_drive"
    && args.status === "failed"
  ));
  assert.ok(mutationCalls.some((args) =>
    args.sessionId === "search_1"
    && (args.patch as any)?.status === "failed"
  ));
});

test("Node Drive resumes continue generation when start analytics were already recorded", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  let jobOnlyMutationCount = 0;
  let jobStatus = "queued";
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) return { status: jobStatus };
      if ("modelId" in args) return { hasVideoGeneration: false };
      if ("messageId" in args) return { status: "failed" };
      if ("userId" in args) return null;
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      if (args.jobId === "job_1" && args.status === "streaming") {
        jobStatus = "streaming";
      }
      if (args.jobId === "job_1" && Object.keys(args).length === 1) {
        jobOnlyMutationCount += 1;
        if (jobOnlyMutationCount === 2) return false;
      }
      return undefined;
    },
  });

  await assert.rejects(
    runGenerationParticipantHandler(
      ctx,
      baseRunGenerationParticipantArgs({ drivePickerBatchId: "drive_batch_1" as any }),
    ),
    (error: unknown) => error instanceof ConvexError,
  );

  assert.ok(mutationCalls.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
  ));
});
