import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { commitMemoryDecisionHandler, type CommitMemoryDecisionArgs } from "../memory/decision_commit";

function fixture() {
  const rows = new Map<string, Record<string, unknown>>([
    ["chat", { _id: "chat", userId: "user" }],
    ["message", { _id: "message", userId: "user", chatId: "chat", role: "user", content: "I left Acme; I now work at Beta.", memoryDecisionCommits: [] }],
    ["old", { _id: "old", userId: "user", content: "User works at Acme", updatedAt: 1, createdAt: 1, sourceType: "chat", sourceMessageId: "original", isPinned: false, isPending: false, isSuperseded: false }],
  ]);
  const embeddings: unknown[] = [];
  let preferences: Record<string, unknown> | null = null;
  let deleting = false;
  const ctx = {
    db: {
      get: async (id: string) => rows.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => { Object.assign(rows.get(id) ?? {}, patch); },
      insert: async (_table: string, value: Record<string, unknown>) => { rows.set("new", { _id: "new", ...value }); return "new"; },
      query: (table: string) => ({ withIndex: (_name: string, callback: (q: unknown) => unknown) => {
        callback({ eq: () => ({ eq: () => ({}) }) });
        return { first: async () => table === "userPreferences" ? preferences : null, unique: async () => deleting ? {} : null };
      } }),
    },
    runMutation: async (_ref: unknown, args: unknown) => { embeddings.push(args); },
  } as unknown as MutationCtx;
  const args: CommitMemoryDecisionArgs = { action: "supersede", evidence: "I left Acme; I now work at Beta.",
    candidate: { userId: "user", content: "User now works at Beta", sourceChatId: "chat" as Id<"chats">, sourceMessageId: "message" as Id<"messages">, createdAt: 2, isPending: false },
    target: { memoryId: "old" as Id<"memories">, content: "User works at Acme", updatedAt: 1 } };
  return { rows, embeddings, ctx, args, setPreferences: (value: Record<string, unknown>) => { preferences = value; }, deleteAccount: () => { deleting = true; } };
}

test("semantic supersession atomically preserves history, queues embeddings and fences replay", async () => {
  const f = fixture();
  assert.equal((await commitMemoryDecisionHandler(f.ctx, f.args))?.action, "supersede");
  assert.equal(f.rows.get("old")?.supersededByMemoryId, "new");
  assert.equal(f.rows.get("new")?.supersedesMemoryId, "old");
  assert.equal(f.rows.get("old")?.sourceMessageId, "original");
  assert.equal(f.embeddings.length, 1);
  assert.equal(await commitMemoryDecisionHandler(f.ctx, f.args), null);
  assert.equal(f.embeddings.length, 1);
  f.rows.delete("new");
  assert.equal(await commitMemoryDecisionHandler(f.ctx, f.args), null);
});

test("semantic judgment cannot overwrite edits, missing targets, another user or changed evidence", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.rows.get("old")!.updatedAt = 3; },
    (f: ReturnType<typeof fixture>) => { f.rows.delete("old"); },
    (f: ReturnType<typeof fixture>) => { f.rows.get("old")!.userId = "other"; },
    (f: ReturnType<typeof fixture>) => { f.rows.get("old")!.isSuperseded = true; },
    (f: ReturnType<typeof fixture>) => { f.rows.get("message")!.content = "Edited evidence"; },
    (f: ReturnType<typeof fixture>) => { f.rows.get("chat")!.isDeleting = true; },
    (f: ReturnType<typeof fixture>) => { f.deleteAccount(); },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(await commitMemoryDecisionHandler(f.ctx, f.args), null);
    assert.equal(f.embeddings.length, 0);
    assert.equal(f.rows.has("new"), false);
  }
});

test("approval settings, pins, manual records and scope remain authoritative", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.args.candidate.isPending = true; },
    (f: ReturnType<typeof fixture>) => { f.setPreferences({ memoryGatingMode: "manualConfirm" }); },
    (f: ReturnType<typeof fixture>) => { f.rows.get("old")!.isPinned = true; },
    (f: ReturnType<typeof fixture>) => { f.rows.get("old")!.sourceType = "manual"; },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal((await commitMemoryDecisionHandler(f.ctx, f.args))?.action, "add");
    assert.equal(f.rows.get("old")?.isSuperseded, false);
    assert.equal(f.rows.get("new")?.supersedesMemoryId, undefined);
  }
  const f = fixture(); f.rows.get("old")!.scopeType = "selectedPersonas";
  assert.equal(await commitMemoryDecisionHandler(f.ctx, f.args), null);
  const disabled = fixture(); disabled.setPreferences({ isMemoryEnabled: false });
  assert.equal(await commitMemoryDecisionHandler(disabled.ctx, disabled.args), null);
});

test("reinforcement preserves source provenance and is idempotent after a later target edit", async () => {
  const f = fixture(); f.args.action = "reinforce";
  const old = f.rows.get("old")!; old.reinforcementCount = 1;
  assert.equal((await commitMemoryDecisionHandler(f.ctx, f.args))?.action, "reinforce");
  assert.equal(old.reinforcementCount, 2);
  assert.equal(old.sourceMessageId, "original");
  assert.equal(f.embeddings.length, 0);
  old.updatedAt = 5;
  assert.equal(await commitMemoryDecisionHandler(f.ctx, f.args), null);
  assert.equal(old.reinforcementCount, 2);
});
