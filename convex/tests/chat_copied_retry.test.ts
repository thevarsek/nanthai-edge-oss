import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { duplicateChatHandler, forkChatHandler } from "../chat/manage_handlers";
import { retryMessageHandler } from "../chat/mutations_retry_handler";

for (const mode of ["duplicate", "fork"] as const) {
  test(`${mode} remaps copied participant identity and preserves the normal Retry journey`, async () => {
    const sourceParticipantId = "participant-source";
    const rows: Record<string, Array<Record<string, unknown>>> = {
      chats: [{ _id: "chat-source", userId: "user_1", title: "Original", mode: "chat",
        activeBranchLeafId: "assistant-source", createdAt: 1, updatedAt: 2 }],
      chatParticipants: [{ _id: sourceParticipantId, chatId: "chat-source", userId: "user_1",
        modelId: "openai/test", sortOrder: 0, createdAt: 1 }],
      messages: [
        { _id: "user-source", chatId: "chat-source", userId: "user_1", role: "user",
          content: "Review this plan", parentMessageIds: [], status: "completed", createdAt: 1 },
        { _id: "assistant-source", chatId: "chat-source", userId: "user_1", role: "assistant",
          content: "The plan is ready", modelId: "openai/test", chatParticipantId: sourceParticipantId,
          parentMessageIds: ["user-source"], status: "completed", createdAt: 2,
          retryContract: { participants: [{ modelId: "openai/test", participantKey: sourceParticipantId }],
            searchMode: "none", subagentsEnabled: false } },
      ],
      accountDeletionTombstones: [], userPreferences: [], generatedMedia: [],
      fileAttachments: [], nodePositions: [], chatAdvisors: [], advisorBatches: [],
      generationJobs: [], streamingMessages: [], executionRuns: [], executionAttempts: [],
      executionComponentRefs: [],
    };
    const ctx = createStatefulMockCtx(rows, {
      runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(ref);
        if (name === "account/deletion_state:isAccountDeletionStarted") return false;
        throw new Error(`Unexpected query ${name}`);
      },
    }) as unknown as MutationCtx;
    const chatId = mode === "fork"
      ? await forkChatHandler(ctx, { chatId: "chat-source" as Id<"chats">,
          atMessageId: "assistant-source" as Id<"messages"> })
      : await duplicateChatHandler(ctx, { chatId: "chat-source" as Id<"chats"> });
    const copiedParticipant = rows.chatParticipants.find(participant => participant.chatId === chatId);
    const copiedResponse = rows.messages.find(message => message.chatId === chatId && message.role === "assistant");
    assert.ok(copiedParticipant && copiedResponse);
    assert.notEqual(copiedParticipant._id, sourceParticipantId);
    assert.equal(copiedResponse.chatParticipantId, copiedParticipant._id);
    assert.deepEqual(copiedResponse.retryContract, {
      participants: [{ modelId: "openai/test", participantKey: copiedParticipant._id }],
      searchMode: "none", subagentsEnabled: false,
    });
    const retry = await retryMessageHandler(ctx, { messageId: copiedResponse._id as Id<"messages"> });
    assert.equal(retry.assistantMessageIds.length, 1);
    const retried = await ctx.db.get(retry.assistantMessageIds[0]);
    assert.equal(retried?.chatId, chatId);
    assert.equal(retried?.chatParticipantId, copiedParticipant._id);
    assert.deepEqual(retried?.parentMessageIds, copiedResponse.parentMessageIds);
    assert.equal(rows.messages.find(message => message._id === "assistant-source")?.status, "completed");
  });
}
