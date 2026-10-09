import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { getMessageHandler, listMessagesHandler, messageExecutionRoute } from "../chat/queries_message_handlers";

function fixture(placement: "cloud" | "local" = "local") {
  const message = {
    _id: "message_1", chatId: "chat_1", role: "assistant", content: "QA response",
    status: "completed", createdAt: 1, parentMessageIds: [], participantId: "deleted_persona",
  } as unknown as Doc<"messages">;
  const rows: Record<string, Record<string, unknown>[]> = {
    chats: [{ _id: "chat_1", userId: "user_1" }], messages: [message], personas: [],
    generationJobs: [{ _id: "job_1", messageId: "message_1", chatId: "chat_1", userId: "user_1", executionRunId: "run_1", executionAttemptId: "attempt_1" }],
    executionAttempts: [{ _id: "attempt_1", runId: "run_1", userId: "user_1", placement, runtimeLabel: placement === "local" ? "Mac · codex" : undefined }],
    chatParticipantRuntimeRoutes: [{ placement: "cloud" }],
  };
  const ctx = createStatefulMockCtx(rows, { runQuery: async () => false }) as unknown as QueryCtx;
  return { rows, ctx, message };
}

test("both public message queries preserve recorded local placement after Persona deletion", async () => {
  const { ctx, message } = fixture();
  const single = await getMessageHandler(ctx, { messageId: message._id });
  const page = await listMessagesHandler(ctx, { chatId: message.chatId });
  const expected = { placement: "local", runtimeLabel: "Mac · codex" };
  assert.deepEqual(single?.executionRoute, expected);
  assert.deepEqual(page[0].executionRoute, expected);
});

test("historical cloud placement does not become local after current routing changes", async () => {
  const { ctx, message, rows } = fixture("cloud");
  rows.chatParticipantRuntimeRoutes[0].placement = "local";
  assert.deepEqual(await messageExecutionRoute(ctx, message), { placement: "cloud", runtimeLabel: undefined });
});

test("unknown provenance and user messages do not infer a route", async () => {
  const { ctx, message, rows } = fixture();
  rows.generationJobs = [];
  assert.equal(await messageExecutionRoute(ctx, message), undefined);
  assert.equal(await messageExecutionRoute(ctx, { ...message, role: "user" }), undefined);
});

test("latest retry uses its recorded attempt and never an unrelated attempt", async () => {
  const { ctx, message, rows } = fixture();
  rows.generationJobs.push({ ...rows.generationJobs[0], _id: "job_retry", executionRunId: "run_retry", executionAttemptId: "attempt_retry" });
  rows.executionAttempts.push({ _id: "attempt_retry", runId: "run_retry", userId: "user_1", placement: "cloud" });
  assert.deepEqual(await messageExecutionRoute(ctx, message), { placement: "cloud", runtimeLabel: undefined });
  rows.executionAttempts[1].userId = "other_user";
  assert.equal(await messageExecutionRoute(ctx, message), undefined);
});


test("both public message queries project the same recovery without mutating stored content", async () => {
  const { ctx, message } = fixture();
  message.status = "failed";
  message.content = 'Error: {"code":"INSUFFICIENT_CREDITS","message":"Your OpenRouter balance is too low for this model."}';
  const original = message.content;
  const single = await getMessageHandler(ctx, { messageId: message._id });
  const page = await listMessagesHandler(ctx, { chatId: message.chatId });
  assert.deepEqual(single?.generationRecovery?.actions, ["openrouter_credits", "change_model"]);
  assert.deepEqual(page[0].generationRecovery, single?.generationRecovery);
  assert.equal(message.content, original);
});
