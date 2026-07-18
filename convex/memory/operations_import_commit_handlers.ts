import type { MutationCtx } from "../_generated/server";
import { requireAuth, requirePro } from "../lib/auth";
import { refreshMemoryEmbedding } from "./operations_embedding_refresh";
import {
  normalizeMemoryScore,
  resolveImportRetrievalMode,
} from "./quality_policy";
import {
  normalizeMemoryCategory,
  normalizeMemoryRecord,
  type MemoryCategory,
  type MemoryRetrievalMode,
} from "./shared";

export interface CommitImportedMemoriesArgs extends Record<string, unknown> {
  memories: Array<{
    content: string;
    category?: MemoryCategory;
    retrievalMode: MemoryRetrievalMode;
    scopeType: "allPersonas" | "selectedPersonas";
    personaIds?: string[];
    tags?: string[];
    isPinned?: boolean;
    sourceFileName?: string;
    importanceScore?: number;
    confidenceScore?: number;
  }>;
  isPending?: boolean;
}

export async function commitImportedMemoriesHandler(
  ctx: MutationCtx,
  args: CommitImportedMemoriesArgs,
): Promise<number> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  let created = 0;

  for (const item of args.memories) {
    const content = item.content.trim();
    const category = normalizeMemoryCategory(item.category, content);
    const normalized = normalizeMemoryRecord({
      content,
      category,
      retrievalMode: resolveImportRetrievalMode(category, content),
      scopeType: item.scopeType,
      personaIds: item.personaIds,
      sourceType: "import",
      sourceFileName: item.sourceFileName,
      tags: item.tags,
    });
    if (!normalized.content) continue;

    const memoryId = await ctx.db.insert("memories", {
      userId,
      content: normalized.content,
      category: normalized.category,
      memoryType: normalized.category === "writingStyle" ? "responsePreference" : "profile",
      retrievalMode: normalized.retrievalMode,
      scopeType: normalized.scopeType,
      personaIds: normalized.personaIds,
      sourceType: "import",
      sourceFileName: normalized.sourceFileName,
      tags: normalized.tags,
      sourceMessageId: undefined,
      sourceChatId: undefined,
      isPinned: item.isPinned ?? false,
      isPending: args.isPending ?? false,
      accessCount: 0,
      importanceScore: normalizeMemoryScore(item.importanceScore, 0.88),
      confidenceScore: normalizeMemoryScore(item.confidenceScore, 0.82),
      reinforcementCount: 1,
      lastReinforcedAt: now,
      isSuperseded: false,
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
    await refreshMemoryEmbedding(ctx, memoryId, userId, normalized.content);
  }
  return created;
}
