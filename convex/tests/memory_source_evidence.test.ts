import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { resolveGenerationMemoryContext } from "../chat/action_memory_helpers";
import { prepareRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import { contextEvidenceCandidates, validateSourceEvidence } from "../chat/source_evidence";
import { hashMemoryCacheTextForPrivacyMode } from "../memory/cache_helpers";

for (const preserveMessageBoundaries of [false, true]) {
  test(`${preserveMessageBoundaries ? "local" : "cloud"} preparation carries delivered authorized shared memories into quote validation`, async () => {
    const sourceId = "source" as Id<"messages">;
    const chatId = "chat" as Id<"chats">;
    const assistantId = "assistant" as Id<"messages">;
    const messages: ContextMessage[] = [
      { _id: sourceId, chatId, role: "user", content: "What are the Atlas embedding dimensions?",
        parentMessageIds: [], status: "completed", createdAt: 1 },
      { _id: assistantId, chatId, role: "assistant", content: "", parentMessageIds: [sourceId],
        status: "pending", createdAt: 2 },
    ];
    const memories = [
      { _id: "shared-fact", content: "Atlas uses 1536 embedding dimensions.", memoryType: "workContext",
        retrievalMode: "contextual", scopeType: "allPersonas", importanceScore: 0.8 },
      { _id: "hidden-fact", content: "Atlas PRIVATE_PERSONA_FACT", scopeType: "selectedPersonas",
        personaIds: ["other-persona"], retrievalMode: "contextual" },
      { _id: "inactive-fact", content: "Atlas SUPERSEDED_FACT", isSuperseded: true, retrievalMode: "contextual" },
    ];
    const ctx = {
      runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(ref);
        if (name.endsWith("getUserMemories")) return memories;
        if (name.endsWith("getMessageMemoryContext")) return { status: "ready", hydratedHits: [],
          textHash: hashMemoryCacheTextForPrivacyMode(messages[0].content, false) };
        if (name.endsWith("listToolMemoriesForAssembly") || name.endsWith("listArtifactsForAssembly")
          || name.endsWith("getInvocationContextsInternal")) return [];
        throw new Error(`Unexpected query ${name}`);
      },
      scheduler: { runAfter: async () => "scheduled" },
    } as unknown as ActionCtx;
    const memory = await resolveGenerationMemoryContext(ctx, { messages, userMessageId: sourceId,
      userId: "user_1", personaId: "persona" as Id<"personas"> });
    assert.deepEqual(memory.evidenceSources.map(source => source.id), ["memory:shared-fact"]);
    assert.doesNotMatch(memory.memoryContext, /PRIVATE_PERSONA_FACT|SUPERSEDED_FACT/);
    const legacyMessages = buildRequestMessages({ messages, excludeMessageId: assistantId,
      memoryContext: memory.memoryContext, preserveMessageBoundaries });
    const prepared = await prepareRequestContextForGeneration({ ctx, chatId, userId: "user_1",
      assistantMessageId: assistantId, jobId: "job" as Id<"generationJobs">, participantId: "persona",
      allMessages: messages, legacyMessages, sharedMemorySources: memory.evidenceSources });
    const answer = 'Atlas uses 1536 dimensions. <SOURCE_CITATIONS>[{"sourceId":"memory:shared-fact",'
      + '"quote":"1536 embedding dimensions","claim":"Atlas uses 1536 dimensions."}]</SOURCE_CITATIONS>';
    assert.deepEqual(validateSourceEvidence(answer, prepared.evidenceSources ?? []).map(source => source.sourceId), ["memory:shared-fact"]);
    // A selected memory omitted from the actual provider context cannot become a source.
    const withoutMemoryText = legacyMessages.filter(message => message.role !== "system");
    assert.deepEqual(contextEvidenceCandidates(withoutMemoryText, [], [], memory.evidenceSources)
      .filter(source => source.kind === "memory"), []);
  });
}
