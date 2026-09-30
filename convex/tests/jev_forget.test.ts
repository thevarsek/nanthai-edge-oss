import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hasForgetInstruction, forgetCommitHandler, projectForgetTarget } from "../memory/decision_forget";
import type { DecisionResult } from "../decisions/client";

function result(choices: string[]): DecisionResult {
  return { answers: Object.fromEntries(choices.map((choice, index) => [`target_${index}`, { type: "choice", choice }])), modelId: "typesafe/jev-1.13", durationMs: 1 };
}

test("forget requires an explicit command and exactly one unambiguous owned target", () => {
  assert.equal(hasForgetInstruction("Please forget that I use Python."), true);
  assert.equal(hasForgetInstruction("Dimentica che uso Python."), true);
  assert.equal(hasForgetInstruction("I no longer use Python."), false);
  const memories = [{ _id: "python", content: "Uses Python" }, { _id: "swift", content: "Uses Swift" }];
  assert.equal(projectForgetTarget(result(["forget", "preserve"]), memories)?._id, "python");
  assert.equal(projectForgetTarget(result(["forget", "forget"]), memories), null);
  assert.equal(projectForgetTarget(result(["forget", "uncertain"]), memories), null);
});

test("explicit forget uses existing relationship/embedding cleanup and revalidates edited evidence/target", async () => {
  const args = { userId: "user", chatId: "chat" as Id<"chats">, messageId: "message" as Id<"messages">,
    evidence: "Forget that I use Python.", memoryId: "memory" as Id<"memories">, content: "User uses Python", updatedAt: 1 };
  for (const state of ["valid", "edited", "otherUser", "changedEvidence", "inferred"]) {
    const memory = { _id: "memory", userId: state === "otherUser" ? "other" : "user", content: "User uses Python", updatedAt: state === "edited" ? 2 : 1, supersedesMemoryId: "predecessor" };
    const message = { _id: "message", userId: "user", chatId: "chat", role: "user", content: state === "changedEvidence" ? "Changed" : args.evidence };
    const rows: Record<string, Record<string, unknown>> = { memory, message, chat: { userId: "user" }, predecessor: { _id: "predecessor", userId: "user", isSuperseded: true, supersededByMemoryId: "memory" } };
    const deleted: string[] = [];
    const ctx = { db: {
      get: async (id: string) => rows[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => { Object.assign(rows[id], patch); },
      delete: async (id: string) => { deleted.push(id); delete rows[id]; },
      query: (table: string) => ({ withIndex: (_name: string, cb: (q: unknown) => unknown) => {
        cb({ eq: () => ({ eq: () => ({}) }) });
        return { unique: async () => null, first: async () => table === "purchaseEntitlements" ? { status: "active" } : table === "memoryEmbeddings" ? { _id: "embedding" } : null,
          collect: async () => table === "memoryRelationships" ? [{ _id: "edge" }] : [] };
      } }),
    } } as unknown as MutationCtx;
    const applied = await forgetCommitHandler(ctx, state === "inferred" ? { ...args, evidence: "I no longer use Python." } : args);
    assert.equal(applied, state === "valid");
    assert.deepEqual(deleted, state === "valid" ? ["edge", "embedding", "memory"] : []);
    if (applied) {
      assert.equal(rows.predecessor.supersededByMemoryId, undefined);
      assert.equal(rows.predecessor.isSuperseded, true);
      assert.equal(await forgetCommitHandler(ctx, args), false);
      assert.deepEqual(rows.message.memoryDecisionCommits, ["forget:memory"]);
    }
  }
});
