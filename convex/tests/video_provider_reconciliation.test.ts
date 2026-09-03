import assert from "node:assert/strict";
import test from "node:test";

import { cancelVideoForExecutionRun } from "../chat/video_cleanup";
import { reconcileCancelledProvider } from "../chat/video_reconciliation";
import { settleVideoGenerationHandler } from "../chat/video_mutation_handlers";
import { recordDirectVideoSubmissionOutcomeHandler } from
  "../chat/video_submission_mutations";
import { recordToolVideoSubmissionOutcome } from
  "../tools/video_generation_submission_mutations";
import { failToolVideo } from "../tools/video_generation_mutations";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("video cancellation targets the exact run and retains provider ownership", async () => {
  const rows = {
    executionRuns: [{
      _id: "run_1",
      domainType: "video_generation",
      domainId: "message_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
    }],
    videoJobs: [{
      _id: "video_older",
      messageId: "message_1",
      status: "in_progress",
      openRouterJobId: "provider_older",
      executionRunId: "run_1",
    }, {
      _id: "video_newer",
      messageId: "message_1",
      status: "in_progress",
      openRouterJobId: "provider_newer",
      executionRunId: "run_2",
    }],
    executionComponentRefs: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await cancelVideoForExecutionRun(ctx as never, "run_1" as never);

  assert.equal(rows.videoJobs[0]?.status, "failed");
  const cancellationPatch = ctx.events.find((entry) =>
    entry.op === "patch" && entry.id === "video_older"
  );
  assert.equal(
    typeof (cancellationPatch?.value as Record<string, unknown>).cancellationRequestedAt,
    "number",
  );
  assert.equal(rows.videoJobs[1]?.status, "in_progress");
  const component = ctx.events.find((entry) => entry.op === "insert");
  assert.equal(component?.table, "executionComponentRefs");
  assert.equal((component?.value as Record<string, unknown>).adapterId, "external-cloud");
  assert.equal(
    (component?.value as Record<string, unknown>).operationId,
    "openrouter-video:video_older",
  );
  assert.equal((component?.value as Record<string, unknown>).status, "cancel_requested");
});

test("video cancellation retains an uploaded blob referenced by completed media", async () => {
  const rows = {
    executionRuns: [{
      _id: "run_1",
      domainType: "video_generation",
      domainId: "message_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
    }],
    videoJobs: [{
      _id: "video_1",
      messageId: "message_1",
      executionRunId: "run_1",
      outputUploadId: "upload_1",
      status: "completed",
      providerTerminalAt: 1,
    }],
    videoOutputUploads: [{
      _id: "upload_1",
      messageId: "message_1",
      storageId: "storage_video",
      status: "uploaded",
    }],
    generatedMedia: [{
      _id: "media_1",
      storageId: "storage_video",
      messageId: "message_1",
      type: "video",
    }],
    fileAttachments: [],
    generatedFiles: [],
    messages: [],
    presentationAssets: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await cancelVideoForExecutionRun(ctx as never, "run_1" as never);

  assert.deepEqual(ctx.storageDeletes, []);
  assert.ok(ctx.events.some((entry) => entry.op === "delete" && entry.id === "upload_1"));
  assert.ok(rows.generatedMedia.some((media) => media._id === "media_1"));
});

test("a provider result arriving after cancellation restores reconciliation ownership", async () => {
  const rows = {
    executionRuns: [{
      _id: "run_1",
      state: "cancelling",
      userId: "user_1",
    }],
    videoJobs: [{
      _id: "video_1",
      messageId: "message_1",
      userId: "user_1",
      generationJobId: "generation_1",
      toolCallId: "tool_1",
      executionRunId: "run_1",
      executionAttemptId: "attempt_1",
      outputUploadId: "upload_1",
      status: "failed",
      cancellationRequestedAt: 1,
    }],
    executionOperations: [{
      _id: "operation_1",
      runId: "run_1",
      attemptId: "attempt_1",
      operationKey: "video_1:provider-submit",
      toolName: "video_provider_submit",
      status: "outcome_unknown",
    }],
    executionComponentRefs: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await (recordToolVideoSubmissionOutcome as any)._handler(ctx, {
    videoJobId: "video_1",
    userId: "user_1",
    generationJobId: "generation_1",
    toolCallId: "tool_1",
    executionAttemptId: "attempt_1",
    operationKey: "video_1:provider-submit",
    openRouterJobId: "provider_1",
    outputUploadId: "upload_1",
    resultJson: JSON.stringify({
      submission: { id: "provider_1", status: "pending" },
      outputUploadId: "upload_1",
    }),
  });

  assert.equal(rows.executionOperations[0]?.status, "reconciled");
  assert.equal(rows.videoJobs[0]?.status, "failed");
  const jobPatch = ctx.events.find((entry) => entry.op === "patch" && entry.id === "video_1");
  assert.equal((jobPatch?.value as Record<string, unknown>).openRouterJobId, "provider_1");
  const component = ctx.events.find((entry) =>
    entry.op === "insert" && entry.table === "executionComponentRefs"
  );
  assert.equal(
    (component?.value as Record<string, unknown>).operationId,
    "openrouter-video:video_1",
  );
  assert.equal((component?.value as Record<string, unknown>).status, "cancel_requested");
});

test("direct provider adoption updates the operation and pre-created owner atomically", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    executionRuns: [{
      _id: "run_1",
      state: "running",
      activeAttemptId: "attempt_1",
      userId: "user_1",
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      fence: 1,
      status: "running",
    }],
    videoJobs: [{
      _id: "video_1",
      messageId: "message_1",
      chatId: "chat_1",
      userId: "user_1",
      generationJobId: "generation_1",
      executionRunId: "run_1",
      executionAttemptId: "attempt_1",
      status: "pending",
    }],
    executionOperations: [{
      _id: "operation_1",
      runId: "run_1",
      attemptId: "attempt_1",
      operationKey: "generation_1:video-provider-submit",
      toolName: "video_provider_submit",
      status: "dispatching",
    }],
    executionComponentRefs: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await recordDirectVideoSubmissionOutcomeHandler(ctx as never, {
    videoJobId: "video_1" as never,
    userId: "user_1",
    generationJobId: "generation_1" as never,
    openRouterJobId: "provider_1",
    executionAttemptId: "attempt_1" as never,
    operationKey: "generation_1:video-provider-submit",
    resultJson: JSON.stringify({ submission: { id: "provider_1", status: "pending" } }),
  });

  assert.equal(rows.executionOperations[0]?.status, "reconciled");
  assert.equal(rows.executionOperations[0]?.externalId, "provider_1");
  assert.equal(rows.videoJobs[0]?.openRouterJobId, "provider_1");
  assert.equal(rows.videoJobs[0]?.status, "in_progress");
});

test("cancellation terminalizes a local row after provider completion", async () => {
  const rows = {
    executionRuns: [{
      _id: "run_1",
      domainType: "video_generation",
      domainId: "message_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
    }],
    videoJobs: [{
      _id: "video_1",
      messageId: "message_1",
      executionRunId: "run_1",
      status: "in_progress",
      openRouterJobId: "provider_1",
      providerTerminalAt: 1,
      providerTerminalStatus: "completed",
    }],
    executionComponentRefs: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await cancelVideoForExecutionRun(ctx as never, "run_1" as never);

  assert.equal(rows.videoJobs[0]?.status, "failed");
  assert.equal(rows.executionComponentRefs.length, 0);
});

test("provider reconciliation releases ownership only after provider terminal state", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  let providerStatus: "in_progress" | "completed" = "in_progress";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "provider_1",
    polling_url: "https://poll",
    status: providerStatus,
    ...(providerStatus === "completed"
      ? { generation_id: "generation_1", usage: { cost: 0.25, is_byok: false } }
      : {}),
  }), { status: 200 })) as typeof fetch;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.videoJobId) return {
        _id: "video_1",
        userId: "user_1",
        chatId: "chat_1",
        messageId: "message_1",
        model: "provider/video-model",
        toolCallId: "tool_1",
        openRouterJobId: "provider_1",
      };
      if (args.userId) return "sk-test";
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
  } as any;

  try {
    assert.equal(await (reconcileCancelledProvider as any)._handler(ctx, { videoJobId: "video_1" }), false);
    assert.deepEqual(mutations, []);
    providerStatus = "completed";
    assert.equal(await (reconcileCancelledProvider as any)._handler(ctx, { videoJobId: "video_1" }), true);
    assert.equal(mutations.length, 2);
    assert.deepEqual(mutations[0], {
      messageId: "message_1",
      chatId: "chat_1",
      userId: "user_1",
      modelId: "provider/video-model",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0.25,
      isByok: false,
      source: "media_tool_video",
      idempotencyKey: "video_1:usage",
      generationId: "generation_1",
    });
    assert.deepEqual(mutations[1], {
      videoJobId: "video_1",
      status: "completed",
      generationId: "generation_1",
      cost: 0.25,
      isByok: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a local tool-video timeout retains provider reconciliation ownership", async () => {
  const rows = {
    chats: [{ _id: "chat_1", userId: "user_1" }],
    accountDeletionTombstones: [],
    executionRuns: [{
      _id: "run_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
      chatId: "chat_1",
      state: "running",
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      fence: 1,
      status: "running",
    }],
    generationJobs: [{ _id: "generation_1", status: "completed" }],
    videoJobs: [{
      _id: "video_1",
      userId: "user_1",
      generationJobId: "generation_1",
      toolCallId: "tool_1",
      executionRunId: "run_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      openRouterJobId: "provider_1",
      status: "in_progress",
      providerTerminalAt: undefined as number | undefined,
    }],
    executionComponentRefs: [] as Array<{
      operationId: string;
      status: string;
      [key: string]: unknown;
    }>,
  };
  const ctx = createStatefulMockCtx(rows);

  const outcome = await (failToolVideo as any)._handler(ctx, {
    videoJobId: "video_1",
    userId: "user_1",
    generationJobId: "generation_1",
    toolCallId: "tool_1",
    workflowResumeEventId: "resume_1",
    error: "Video generation timed out after polling.",
    executionAttemptId: "attempt_1",
    executionFence: 1,
  });

  assert.equal(outcome, "terminal");
  assert.equal(rows.videoJobs[0]?.status, "failed");
  assert.equal(rows.videoJobs[0]?.providerTerminalAt, undefined);
  assert.equal(rows.executionComponentRefs.length, 1);
  assert.equal(rows.executionComponentRefs[0]?.operationId, "openrouter-video:video_1");
  assert.equal(rows.executionComponentRefs[0]?.status, "cancel_requested");
});

test("local video settlement retains provider ownership and releases abandoned uploads", async () => {
  const rows = {
    videoJobs: [{
      _id: "video_1",
      status: "in_progress",
      outputUploadId: "upload_1",
    }],
    videoOutputUploads: [{
      _id: "upload_1",
      status: "uploaded",
      storageId: "orphaned_video",
    }],
    generationJobs: [{
      _id: "job_1",
      messageId: "message_1",
      chatId: "chat_1",
      userId: "user_1",
      status: "streaming",
    }],
    generationContinuations: [],
    streamingMessages: [],
    messages: [{
      _id: "message_1",
      chatId: "chat_1",
      userId: "user_1",
      role: "assistant",
      content: "",
      status: "streaming",
      parentMessageIds: [],
    }],
    usageRecords: [],
    cachedModels: [],
  };
  const ctx = createStatefulMockCtx(rows);

  await settleVideoGenerationHandler(ctx as never, {
    videoJobId: "video_1",
    messageId: "message_1",
    jobId: "job_1",
    chatId: "chat_1",
    content: "Error: local timeout",
    status: "failed",
    error: "local timeout",
    userId: "user_1",
  } as any);

  const videoPatch = ctx.events.find((entry) =>
    entry.op === "patch" && entry.id === "video_1"
  )?.value as Record<string, unknown> | undefined;
  assert.equal(videoPatch?.status, "failed");
  assert.equal("providerTerminalAt" in (videoPatch ?? {}), false);
  assert.equal("providerTerminalStatus" in (videoPatch ?? {}), false);
  assert.deepEqual(ctx.storageDeletes, ["orphaned_video"]);
  assert.equal(rows.videoOutputUploads.length, 0);
});
