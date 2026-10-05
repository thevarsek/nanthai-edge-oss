import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { memorySelectionContext, type MemorySelectionMessage } from "../chat/memory_selection_context";
import { resolveMemoryContextForGeneration } from "../chat/action_memory_helpers";
import { hashMemoryCacheTextForPrivacyMode } from "../memory/cache_helpers";

const id = (value: string) => value as Id<"messages">;
const messages: MemorySelectionMessage[] = [
  { _id: id("task"), role: "user", content: "Plan atlas embedding dimensions and funding with helper isolation.", parentMessageIds: [] },
  { _id: id("draft"), role: "assistant", content: "Draft an atlas memory plan.", parentMessageIds: [id("task")] },
  { _id: id("other"), role: "user", content: "UNRELATED_PRIVATE_BRANCH gardening", parentMessageIds: [id("task")] },
  { _id: id("review"), role: "user", content: "Review this plan and correct it.", parentMessageIds: [id("draft")] },
  { _id: id("future"), role: "assistant", content: "FUTURE_RESPONSE", parentMessageIds: [id("review")] },
];

test("memory selection preserves the task topic while leaving the prewarm query unchanged", () => {
  const result = memorySelectionContext(messages, id("review"));
  assert.equal(result.queryText, messages[3].content);
  assert.match(result.selectionText, /atlas embedding dimensions and funding/);
  assert.match(result.selectionText, /Draft an atlas memory plan/);
  assert.doesNotMatch(result.selectionText, /UNRELATED_PRIVATE_BRANCH|FUTURE_RESPONSE/);
});

test("memory selection handles scoped history callers and blank prompts", () => {
  const scoped = messages.filter(message => !["other", "future"].includes(message._id))
    .map(({ parentMessageIds: _parents, ...message }) => message);
  assert.match(memorySelectionContext(scoped, id("review")).selectionText, /atlas embedding/);
  assert.deepEqual(memorySelectionContext([{ _id: id("empty"), role: "user", content: " " }], id("empty")),
    { queryText: "", selectionText: "" });
});

for (const cache of ["failed", "ready"] as const) {
  test(`shared generation resolver preserves facts with ${cache} generic-follow-up cache`, async () => {
    const memories = [
      ...Array.from({ length: 12 }, (_, index) => ({ _id: `noise-${index}`, content: `Review plan checklist ${index}` })),
      { _id: "facts", content: "Atlas embedding dimensions and funding: 1536 dimensions, platform funding, isolated helper sessions." },
      { _id: "private", content: "Atlas embedding PRIVATE_PERSONA_FACT", scopeType: "selectedPersonas", personaIds: ["other-persona"] },
      { _id: "inactive", content: "Atlas embedding SUPERSEDED_FACT", isSuperseded: true },
    ].map(memory => ({ memoryType: "workContext", retrievalMode: "contextual", importanceScore: 0.7,
      scopeType: "allPersonas", ...memory }));
    const touched: string[][] = [];
    let embeddings = 0;
    const ctx = {
      runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(ref);
        if (name.endsWith("getUserMemories")) return memories;
        if (name.endsWith("getMessageMemoryContext")) return { status: cache,
          textHash: hashMemoryCacheTextForPrivacyMode(messages[3].content, false),
          hydratedHits: cache === "ready" ? memories.slice(0, 12) : [], errorCode: "embedding_not_ready" };
        throw new Error(`Unexpected query ${name}`);
      },
      runMutation: async () => { throw new Error("This retrieval needs no mutation"); },
      vectorSearch: async () => { embeddings++; throw new Error("No inline embedding/vector work"); },
      scheduler: { runAfter: async (_delay: number, _ref: unknown, args: { memoryIds?: string[] }) => {
        if (args.memoryIds) touched.push(args.memoryIds);
      } },
    } as unknown as Pick<ActionCtx, "runQuery" | "runMutation" | "vectorSearch" | "scheduler">;
    const result = await resolveMemoryContextForGeneration(ctx, { messages, userMessageId: id("review"), userId: "qa" });
    assert.match(result, /1536 dimensions, platform funding, isolated helper sessions/);
    assert.doesNotMatch(result, /PRIVATE_PERSONA_FACT|SUPERSEDED_FACT/);
    assert.equal(embeddings, 0);
    assert.ok(touched.flat().includes("facts"));
    assert.ok(touched.flat().length <= 12);
  });
}
