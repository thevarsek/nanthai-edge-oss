import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { runGenerationParticipantHandler } from "../chat/actions_run_generation_participant_action";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

function streamResponse(content: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      `data: ${JSON.stringify({ id: "gen_resume", choices: [{ delta: { content } }] })}`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function baseArgs() {
  return {
    chatId: "chat_1" as any,
    userMessageId: "msg_user_original" as any,
    assistantMessageIds: ["msg_assistant_original" as any],
    generationJobIds: ["job_original" as any],
    participant: {
      modelId: "model_original",
      messageId: "msg_assistant_original" as any,
      jobId: "job_original" as any,
    } as any,
    userId: "user_original",
    expandMultiModelGroups: true,
    webSearchEnabled: true,
    effectiveIntegrations: ["gmail"],
    directToolNames: ["search_chats"],
    isPro: false,
    allowSubagents: true,
    resumeExpected: true,
    drivePickerBatchId: "drive_batch_1" as any,
  };
}

test("runGenerationParticipantHandler resumes from continuation state and finalizes the effective participant", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse("Resumed parent answer.")) as any;

  const mutationCalls: Array<Record<string, unknown>> = [];
  let claimCount = 0;
  let jobQueryCount = 0;
  let messageQueryCount = 0;
  const continuationState = {
    group: {
      chatId: "chat_1",
      userMessageId: "msg_user_resume",
      assistantMessageIds: ["msg_assistant_resume"],
      generationJobIds: ["job_resume"],
      userId: "user_1",
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      effectiveIntegrations: [],
      directToolNames: [],
      isPro: true,
      allowSubagents: false,
      disableTools: true,
    },
    participant: {
      modelId: "model_1",
      messageId: "msg_assistant_resume",
      jobId: "job_resume",
    },
    messages: [{ role: "user", content: "Continue after subagents." }],
    continuationCount: 999,
    activeProfiles: [],
    loadedSkills: [],
    toolCalls: [],
    toolResults: [],
    compactionCount: 0,
  };

  const ctx = createMockCtx({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      if (Object.keys(args).length === 1 && args.jobId === "job_original") {
        claimCount += 1;
        return claimCount === 1 ? continuationState : undefined;
      }
      return undefined;
    },
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        jobQueryCount += 1;
        if (jobQueryCount === 1) {
          return { _id: "job_resume", status: "streaming", streamingMessageId: "stream_resume" };
        }
        if (jobQueryCount === 2) return false;
        return { _id: "job_resume", status: "completed" };
      }
      if ("modelId" in args) {
        return {
          provider: "openai",
          supportedParameters: [],
          hasZdrEndpoint: true,
          hasImageGeneration: false,
          hasReasoning: false,
          contextLength: 128_000,
        };
      }
      if ("userId" in args) return "sk-test";
      if ("messageId" in args) {
        messageQueryCount += 1;
        return messageQueryCount === 1
          ? null
          : { _id: "msg_assistant_resume", status: "completed" };
      }
      return null;
    },
    scheduler: {
      runAfter: async () => "scheduled_1",
      runAt: async () => "scheduled_at_1",
    },
    storage: {
      get: async () => null,
      getUrl: async () => null,
      store: async () => "storage_1",
    },
  });

  await runGenerationParticipantHandler(ctx, baseArgs());

  assert.ok(mutationCalls.some((args) =>
    args.jobId === "job_resume"
    && args.status === "streaming"
    && args.startedAt
  ));
  assert.ok(mutationCalls.some((args) =>
    args.messageId === "msg_assistant_resume"
    && args.jobId === "job_resume"
    && args.status === "completed"
    && args.content === "Resumed parent answer."
    && args.openrouterGenerationId === "gen_resume"
  ));
  assert.ok(mutationCalls.some((args) => args.jobId === "job_resume"));
  assert.ok(mutationCalls.some((args) =>
    args.batchId === "drive_batch_1"
    && args.status === "completed"
  ));
  assert.equal(mutationCalls.some((args) => args.jobId === "job_original" && args.status), false);
});
