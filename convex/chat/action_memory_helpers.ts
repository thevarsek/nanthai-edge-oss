import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { formatMemoryContext } from "./helpers";
import { selectMemoriesForContext } from "./actions_memory_lifecycle";
import {
  isMemoryActive,
  isMemoryVisibleToPersona,
  type MemoryRecordLike,
  normalizeMemoryRecord,
  prioritizeAlwaysOnMemories,
} from "../memory/shared";
import { MODEL_IDS } from "../lib/model_constants";
import { ttftLog } from "../lib/generation_log";
import { memorySelectionContext, type MemorySelectionMessage } from "./memory_selection_context";
import type { EvidenceCandidate } from "./source_evidence";
import { resolveHydratedHits, type ActionContextLike } from "./action_memory_cache";

interface MemoryContextArgs {
  messages: MemorySelectionMessage[];
  userMessageId: Id<"messages">;
  userId: string;
  personaId?: Id<"personas"> | null;
  // M23: Optional chat attribution for embedding cost tracking.
  chatId?: Id<"chats">;
  assistantMessageId?: Id<"messages">;
  requireZdr?: boolean;
}

type NormalizedMemory = ReturnType<typeof normalizeMemoryRecord>;

export async function resolveMemoryContextForGeneration(
  ctx: ActionContextLike,
  args: MemoryContextArgs,
): Promise<string> {
  return (await resolveGenerationMemoryContext(ctx, args)).memoryContext;
}

export async function resolveGenerationMemoryContext(
  ctx: ActionContextLike,
  args: MemoryContextArgs,
): Promise<{ memoryContext: string; evidenceSources: EvidenceCandidate[] }> {
  const resolutionStartedAt = Date.now();
  const { queryText: memoryQueryText, selectionText } = memorySelectionContext(args.messages, args.userMessageId);
  const allMemoriesPromise = ctx.runQuery(
    internal.chat.queries.getUserMemories,
    { userId: args.userId },
  );

  // Consult the prewarmed memory-context cache. A ready hit avoids embedding,
  // vector search, and hydration on the generation path; any miss degrades to
  // broad contextual memory instead of blocking TTFT with inline retrieval.
  const relevantMemoriesPromise = memoryQueryText.length > 0
    ? resolveHydratedHits(ctx, {
      userId: args.userId,
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageId: args.assistantMessageId,
      memoryQueryText,
      requireZdr: args.requireZdr === true,
    })
    : Promise.resolve([]);

  const [allMemoriesRaw, relevantMemoriesRaw] = await Promise.all([
    allMemoriesPromise,
    relevantMemoriesPromise,
  ]);
  ttftLog("[generation] memory base query loaded", {
    userId: args.userId,
    chatId: args.chatId ?? null,
    messageId: args.assistantMessageId ?? null,
    durationMs: Date.now() - resolutionStartedAt,
    memoryCount: allMemoriesRaw.length,
  });

  const allMemories = allMemoriesRaw
    .map((memory: MemoryRecordLike) => normalizeMemoryRecord(memory))
    .filter((memory: NormalizedMemory) => isMemoryActive(memory))
    .filter((memory: NormalizedMemory) => isMemoryVisibleToPersona(memory, args.personaId));

  const alwaysOn = prioritizeAlwaysOnMemories(
    allMemories.filter((memory: NormalizedMemory) => memory.retrievalMode === "alwaysOn"),
    MODEL_IDS.memoryAlwaysOnLimit,
  );

  let memoryCandidates = relevantMemoriesRaw
        .map((memory: MemoryRecordLike) => normalizeMemoryRecord(memory))
        .filter(
          (memory: NormalizedMemory) =>
            memory.retrievalMode === "contextual" &&
            isMemoryVisibleToPersona(memory, args.personaId),
        );

  if (memoryCandidates.length === 0) {
    memoryCandidates = allMemories.filter(
      (memory: NormalizedMemory) => memory.retrievalMode === "contextual",
    );
  }
  if (selectionText !== memoryQueryText) {
    // A generic follow-up's cached hits can omit the original task's facts.
    // Keep their retrieval scores, while allowing authorized memories to compete.
    const candidatesById = new Map(allMemories.filter(memory => memory.retrievalMode === "contextual")
      .map(memory => [memory._id, memory]));
    for (const memory of memoryCandidates) candidatesById.set(memory._id, memory);
    memoryCandidates = [...candidatesById.values()];
  }

  const contextual = selectMemoriesForContext(
    memoryCandidates,
    selectionText,
    12,
  );
  const selected = [
    ...alwaysOn,
    ...contextual.filter(
      (memory) => !alwaysOn.some((alwaysOnMemory) => alwaysOnMemory._id === memory._id),
    ),
  ];

  const selectedIds = selected
    .map((memory) => memory._id)
    .filter((id): id is Id<"memories"> => typeof id === "string");
  if (selectedIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.touchMemories, {
      memoryIds: selectedIds,
      touchedAt: Date.now(),
    });
    ttftLog("[generation] memories touched (scheduled)", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      touchedCount: selectedIds.length,
    });
  }

  const memoryContext = formatMemoryContext(
    selected.map((memory) => ({
      content: memory.content,
      isPinned: memory.isPinned ?? false,
      memoryType: memory.memoryType,
      category: "category" in memory ? memory.category : undefined,
      retrievalMode: "retrievalMode" in memory ? memory.retrievalMode : undefined,
      importanceScore: memory.importanceScore,
    })),
  ) ?? "";
  return {
    memoryContext,
    evidenceSources: selected.flatMap(memory => memory._id && memory.content.trim() ? [{
      id: `memory:${String(memory._id)}`,
      kind: "memory" as const,
      label: memory.content.slice(0, 80),
      text: memory.content,
    }] : []),
  };
}
