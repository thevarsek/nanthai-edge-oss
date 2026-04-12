import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { runGenerationParticipantHandler } from "../chat/actions_run_generation_participant_action";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

test("runGenerationParticipantHandler finalizes and clears state before rethrowing ConvexError", async () => {
  let jobStatus = "queued";
  const mutationCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return { status: jobStatus };
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
    runGenerationParticipantHandler(ctx, {
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
    }),
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
