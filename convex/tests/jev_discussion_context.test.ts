import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getDecisionContextHandler } from "../autonomous/decision_context";

function fixture() {
  const rows: Record<string, Record<string, unknown>> = {
    chat: { _id: "chat", userId: "user", activeBranchLeafId: "b" },
    human: { _id: "human", chatId: "chat", userId: "user", role: "user", status: "completed", content: "Choose A or B with evidence.", createdAt: 1, parentMessageIds: [] },
    a: { _id: "a", chatId: "chat", userId: "user", role: "assistant", status: "completed", content: "A is faster.", chatParticipantId: "participant_a", createdAt: 2, parentMessageIds: ["human"] },
    b: { _id: "b", chatId: "chat", userId: "user", role: "assistant", status: "completed", content: "B is cheaper.", chatParticipantId: "participant_b", createdAt: 3, parentMessageIds: ["human"] },
    other: { _id: "other", chatId: "different", userId: "other", role: "assistant", status: "completed", content: "Private", createdAt: 4, parentMessageIds: [] },
  };
  const ctx = { db: { get: async (id: string) => rows[id] ?? null } } as unknown as QueryCtx;
  const args = { chatId: "chat" as Id<"chats">, userId: "user", parentMessageIds: ["a", "b", "other"] as Id<"messages">[] };
  return { ctx, args, rows };
}

test("discussion context includes every committed current parent and its question, excluding unrelated branches/users", async () => {
  const f = fixture();
  const context = await getDecisionContextHandler(f.ctx, f.args);
  assert.equal(context?.question, "Choose A or B with evidence.");
  assert.deepEqual(context?.messages.map((message) => message.id), ["human", "a", "b"]);
  assert.equal(context?.messages[1].speaker, "participant_a");
  f.rows.b.status = "streaming";
  assert.deepEqual((await getDecisionContextHandler(f.ctx, f.args))?.messages.map((message) => message.id), ["human", "a"]);
  f.rows.chat.isDeleting = true;
  assert.equal(await getDecisionContextHandler(f.ctx, f.args), null);
});

test("new user question fences older discussion and cyclic/missing ancestry is bounded", async () => {
  const f = fixture();
  f.rows.newHuman = { ...f.rows.human, _id: "newHuman", content: "What about C?", createdAt: 5, parentMessageIds: ["b"] };
  f.rows.latest = { ...f.rows.a, _id: "latest", createdAt: 6, parentMessageIds: ["newHuman", "missing", "latest"] };
  f.args.parentMessageIds = ["latest" as Id<"messages">];
  const context = await getDecisionContextHandler(f.ctx, f.args);
  assert.equal(context?.question, "What about C?");
  assert.deepEqual(context?.messages.map((message) => message.id), ["newHuman", "latest"]);
});
