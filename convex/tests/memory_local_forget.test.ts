import assert from "node:assert/strict";
import test from "node:test";
import type { ActionCtx } from "../_generated/server";
import { consumeLocalForget, parseLocalForget } from "../memory/decision_forget_local";

test("local forget validates every bounded choice without claiming a Jev result", () => {
  assert.equal(parseLocalForget('{"answers":{"target_0":{"type":"choice","choice":"forget"}}}', ["target_0"]).modelId, "gpt-6-luna");
  for (const content of ['{"answers":{}}', '{"answers":{"target_0":{"type":"choice","choice":"delete"}}}', '{"answers":{"other":{"type":"choice","choice":"forget"}}}']) {
    assert.throws(() => parseLocalForget(content, ["target_0"]));
  }
});

test("local forget preserves ambiguity and commits the original candidate snapshot with its helper fence", async () => {
  const commits: unknown[] = [];
  const ctx = { runMutation: async (_api: unknown, args: unknown) => { commits.push(args); return true; } } as unknown as ActionCtx;
  const input = JSON.stringify({ userId: "user_1", chatId: "chat_1", userMessageId: "message_1", userMessageContent: "Forget my favourite flower", candidates: [
    { _id: "memory_1", content: "Favourite flower is orchid", updatedAt: 7, scopeType: "global" },
    { _id: "memory_2", content: "Tea at 62C", updatedAt: 9, scopeType: "global" },
  ] });
  const execution = { executionAttemptId: "attempt_1", executionFence: 8 } as Parameters<typeof consumeLocalForget>[3];
  const answers = (second: string) => JSON.stringify({ answers: { target_0: { type: "choice", choice: "forget" }, target_1: { type: "choice", choice: second } } });
  await consumeLocalForget(ctx, input, answers("uncertain"), execution);
  assert.equal(commits.length, 0);
  await consumeLocalForget(ctx, input, answers("preserve"), execution);
  assert.deepEqual(commits, [{ userId: "user_1", chatId: "chat_1", messageId: "message_1", evidence: "Forget my favourite flower", memoryId: "memory_1", content: "Favourite flower is orchid", updatedAt: 7, scopeSnapshot: { scopeType: "allPersonas", personaIds: [] }, ...execution }]);
});
