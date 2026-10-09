import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowCtx } from "@convex-dev/workflow";
import { getFunctionName } from "convex/server";
import { runGenerationParticipantWorkflowHandler } from "../chat/generation_workflow";

const LOCAL_DISPATCH_CONTEXT_REF =
  "runtime_host/chat_dispatch_queries:getLocalGenerationDispatchContext";

test("Drive deferred ownership resumes with a fresh provider context", async () => {
  const actions: Array<Record<string, unknown>> = [];
  let jobReads = 0;
  const step = {
    workflowId: "workflow_drive",
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("roundKey" in args) return "ready";
      return `event_${String(args.name)}`;
    },
    runAction: async (ref: unknown, args: Record<string, unknown>) => {
      if (getFunctionName(ref as never) === "chat/conversation_context_actions:plan") return null;
      actions.push(args);
      return null;
    },
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      if (getFunctionName(ref as never) === LOCAL_DISPATCH_CONTEXT_REF) return null;
      if ("modelId" in args) return null;
      jobReads += 1;
      if (jobReads === 1) return { _id: "job_1", status: "streaming" };
      if (jobReads === 2) {
        return {
          _id: "continuation_1",
          deferredResumeEventId: "event_gen:0",
          deferredOwnership: { kind: "drive_picker", batchId: "drive_1" },
        };
      }
      return { _id: "job_1", status: "completed" };
    },
    awaitEvent: async () => ({
      mode: "fresh" as const,
      drivePickerBatchId: "drive_1",
    }),
    runWorkflow: async () => null,
    sleep: async () => undefined,
  } as unknown as WorkflowCtx;

  await runGenerationParticipantWorkflowHandler(step, {
    chatId: "chat_1" as never,
    userMessageId: "message_user" as never,
    assistantMessageIds: ["message_assistant" as never],
    generationJobIds: ["job_1" as never],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "message_assistant" as never,
      jobId: "job_1" as never,
    },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: true,
    executionAttemptId: "attempt_1" as never,
    executionFence: 7,
  });
  assert.equal(actions.length, 2);
  assert.equal(actions[1]?.resumeExpected, false);
  assert.equal(actions[1]?.drivePickerBatchId, "drive_1");
});
