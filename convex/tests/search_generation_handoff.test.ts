import assert from "node:assert/strict";
import test from "node:test";

import { commitGenerationHandoffHandler } from
  "../search/generation_handoff";

const generationArgs = {
  chatId: "chat_1",
  userMessageId: "message_user",
  assistantMessageIds: ["message_assistant"],
  generationJobIds: ["generation_1"],
  participants: [{
    modelId: "openai/gpt-5",
    messageId: "message_assistant",
    jobId: "generation_1",
  }],
  userId: "user_1",
  expandMultiModelGroups: false,
  webSearchEnabled: false,
};

test("search generation handoff starts and journals exactly once", async () => {
  const session: Record<string, unknown> = {
    _id: "search_1",
    userId: "user_1",
    status: "searching",
  };
  let starts = 0;
  const ctx = {
    db: {
      get: async () => session,
      patch: async (_id: string, patch: Record<string, unknown>) => {
        Object.assign(session, patch);
      },
    },
  } as never;
  const args = {
    sessionId: "search_1",
    generationArgs,
    progress: 90,
    searchCallCount: 3,
    perplexityModelTier: "sonar-pro",
    participantCount: 1,
  } as never;
  const start = async () => {
    starts += 1;
    return "workflow_generation_1";
  };
  assert.equal(
    await commitGenerationHandoffHandler(ctx, args, start),
    "workflow_generation_1",
  );
  assert.equal(
    await commitGenerationHandoffHandler(ctx, args, start),
    "workflow_generation_1",
  );
  assert.equal(starts, 1);
  assert.equal(session.status, "writing");
  assert.equal(session.generationHandoffOperationId, "workflow_generation_1");
});
