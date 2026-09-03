import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { durableWorkflow } from "../execution/components";
import { reconcileToolVideoWorkflowFailure } from
  "../tools/video_generation_failure";
import { completeToolVideo } from "../tools/video_generation_mutations";

function settlementRows() {
  return {
    accountDeletionTombstones: [],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    messages: [{
      _id: "message_1",
      userId: "user_1",
      chatId: "chat_1",
      videoUrls: ["https://files.example/existing.mp4"],
    }],
    generationJobs: [{
      _id: "generation_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      status: "streaming",
      executionAttemptId: "parent_attempt",
      executionFence: 1,
    }],
    generationContinuations: [{
      _id: "continuation_1",
      jobId: "generation_1",
      userId: "user_1",
      executionAttemptId: "parent_attempt",
      executionFence: 1,
      deferredResumeEventId: "event_1",
      toolCalls: [{ id: "call_1", name: "generate_video", arguments: "{}" }],
      toolResults: [] as Array<{ result: string }>,
      requestMessages: [{
        role: "tool",
        tool_call_id: "call_1",
        content: "Video generation is pending.",
      }],
      status: "waiting",
    }],
    executionRuns: [{
      _id: "video_run_1",
      userId: "user_1",
      chatId: "chat_1",
      activeAttemptId: "video_attempt_1",
      state: "running",
      domainType: "video_generation",
      domainId: "message_1",
    }],
    executionAttempts: [{
      _id: "video_attempt_1",
      runId: "video_run_1",
      fence: 2,
      status: "running",
    }],
    videoJobs: [{
      _id: "video_job_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      generationJobId: "generation_1",
      toolCallId: "call_1",
      workflowId: "workflow_1",
      parentResumeEventId: "event_1",
      executionRunId: "video_run_1",
      executionAttemptId: "video_attempt_1",
      executionFence: 2,
      status: "in_progress",
      model: "provider/video-model",
      prompt: "A tracking shot",
      videoConfig: { duration: 5 },
      pollCount: 1,
      error: undefined as string | undefined,
      createdAt: 1,
    }],
    generatedMedia: [],
    videoOutputUploads: [],
  };
}

test("tool video completion attaches the durable artifact before resuming its parent", async (t) => {
  t.after(() => mock.restoreAll());
  t.mock.method(durableWorkflow, "sendEvent", async () => undefined);
  const rows = settlementRows();
  const ctx = createStatefulMockCtx(rows);

  const completed = await (completeToolVideo as any)._handler(ctx, {
    videoJobId: "video_job_1",
    userId: "user_1",
    generationJobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    storageId: "storage_video_1",
    videoUrl: "https://files.example/generated.mp4",
    mimeType: "video/mp4",
    sizeBytes: 42,
    executionAttemptId: "video_attempt_1",
    executionFence: 2,
  });
  const repeated = await (completeToolVideo as any)._handler(ctx, {
    videoJobId: "video_job_1",
    userId: "user_1",
    generationJobId: "generation_1",
    toolCallId: "call_1",
    workflowResumeEventId: "event_1",
    storageId: "storage_video_1",
    videoUrl: "https://files.example/generated.mp4",
    mimeType: "video/mp4",
    sizeBytes: 42,
    executionAttemptId: "video_attempt_1",
    executionFence: 2,
  });

  assert.equal(completed, true);
  assert.equal(repeated, true);
  assert.deepEqual(rows.messages[0]?.videoUrls, [
    "https://files.example/existing.mp4",
    "https://files.example/generated.mp4",
  ]);
  assert.equal(rows.generatedMedia.length, 1);
  assert.equal(rows.videoJobs[0]?.status, "completed");
  assert.equal(rows.generationContinuations[0]?.deferredResumeEventId, undefined);
  assert.match(
    String(rows.generationContinuations[0]?.toolResults[0]?.result),
    /storage_video_1/,
  );
});

test("workflow failure reconciliation records the error and resumes the waiting parent", async (t) => {
  t.after(() => mock.restoreAll());
  t.mock.method(durableWorkflow, "sendEvent", async () => undefined);
  const rows = settlementRows();
  const ctx = createStatefulMockCtx(rows);

  const handled = await reconcileToolVideoWorkflowFailure(
    ctx as never,
    rows.executionRuns[0] as never,
    "Workflow interrupted: provider poll failed",
  );

  assert.equal(handled, true);
  assert.equal(rows.videoJobs[0]?.status, "failed");
  assert.match(String(rows.videoJobs[0]?.error), /provider poll failed/);
  assert.equal(rows.generationContinuations[0]?.deferredResumeEventId, undefined);
  assert.deepEqual(JSON.parse(
    String(rows.generationContinuations[0]?.toolResults[0]?.result),
  ), { error: "Workflow interrupted: provider poll failed" });
});
