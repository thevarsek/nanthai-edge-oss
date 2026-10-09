import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import { prepareRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { validateSourceEvidence } from "../chat/source_evidence";

const chatId = "chat" as Id<"chats">;
const messages: ContextMessage[] = [
  { _id: "user-1" as Id<"messages">, chatId, role: "user", content: "Review two plans",
    parentMessageIds: [], status: "completed", createdAt: 1 },
  { _id: "answer-1" as Id<"messages">, chatId, role: "assistant", content: "Atlas uses 1536 dimensions.",
    parentMessageIds: ["user-1" as Id<"messages">], participantName: "Architect",
    multiModelGroupId: "group", isMultiModelResponse: true, status: "completed", createdAt: 2 },
  { _id: "answer-2" as Id<"messages">, chatId, role: "assistant", content: "Atlas is funded with 50 GBP.",
    parentMessageIds: ["user-1" as Id<"messages">], participantName: "Reviewer",
    multiModelGroupId: "group", isMultiModelResponse: true, status: "completed", createdAt: 3 },
  { _id: "user-2" as Id<"messages">, chatId, role: "user", content: "What are the dimensions and funding?",
    parentMessageIds: ["answer-1" as Id<"messages">], status: "completed", createdAt: 4 },
  { _id: "next" as Id<"messages">, chatId, role: "assistant", content: "",
    parentMessageIds: ["user-2" as Id<"messages">], status: "pending", createdAt: 5 },
];

async function prepare(maxContextTokens?: number) {
  const ctx = { runQuery: async () => [], scheduler: { runAfter: async () => "log" } } as unknown as ActionCtx;
  return prepareRequestContextForGeneration({ ctx, chatId, userId: "user", assistantMessageId: messages[4]._id,
    jobId: "job" as Id<"generationJobs">, participantId: "participant", allMessages: messages,
    legacyMessages: buildRequestMessages({ messages, excludeMessageId: messages[4]._id, maxContextTokens }),
  });
}

test("cloud multi-model follow-up validates each contributing assistant source separately", async () => {
  const prepared = await prepare();
  assert.equal(prepared.providerMessages.filter(message => message.role === "assistant").length, 1);
  const sources = prepared.evidenceSources ?? [];
  assert.deepEqual(sources.filter(source => source.id.startsWith("message:answer")).map(source => source.text),
    ["Atlas uses 1536 dimensions.", "Atlas is funded with 50 GBP."]);
  const content = 'Atlas uses 1536 dimensions and has 50 GBP. <SOURCE_CITATIONS>' + JSON.stringify([
    { sourceId: "message:answer-1", quote: "1536 dimensions" },
    { sourceId: "message:answer-2", quote: "50 GBP" },
  ]) + "</SOURCE_CITATIONS>";
  assert.deepEqual(validateSourceEvidence(content, sources).map(source => source.sourceId),
    ["message:answer-1", "message:answer-2"]);
  assert.deepEqual(validateSourceEvidence('Funding. <SOURCE_CITATIONS>' + JSON.stringify([
    { sourceId: "message:answer-1", quote: "50 GBP" },
  ]) + "</SOURCE_CITATIONS>", sources), []);
});

test("raw context retains source evidence before shared durable compaction", async () => {
  const prepared = await prepare(10);
  const sources = prepared.evidenceSources ?? [];
  assert.equal(prepared.providerMessages.some(message => message.role === "assistant"), true);
  assert.equal(sources.some(source => source.id.startsWith("message:answer")), true);
  assert.deepEqual(validateSourceEvidence('Dimensions. <SOURCE_CITATIONS>' + JSON.stringify([
    { sourceId: "message:answer-1", quote: "1536 dimensions" },
  ]) + "</SOURCE_CITATIONS>", sources).map(source => source.sourceId), ["message:answer-1"]);
});
