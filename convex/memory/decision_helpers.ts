import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { tryJevDecision } from "../decisions/service";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { isZdrEnabled } from "../lib/openrouter_zdr";
import { memoryDecisionRequest, projectMemoryDecision, reconciliationCandidates, type MemoryDecision } from "./decision_policy";
import type { MemoryRecordLike } from "./shared";
import type { DecisionMemoryCandidate } from "./decision_commit";

export async function reconcileAdmittedMemory(ctx: ActionCtx, candidate: DecisionMemoryCandidate & { sourceChatId: Id<"chats">; sourceMessageId: Id<"messages"> }, evidence: string, memories: MemoryRecordLike[]) {
  try {
    const [apiKey, preferences, context] = await Promise.all([
      getRequiredUserOpenRouterApiKey(ctx, candidate.userId),
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId: candidate.userId }),
      ctx.runQuery(internal.memory.operations.getMessageMemoryContext, { messageId: candidate.sourceMessageId }),
    ]);
    const candidates = reconciliationCandidates(memories, candidate.content, context?.status === "ready" ? context.hydratedHits as MemoryRecordLike[] ?? [] : []);
    const result = await tryJevDecision(ctx, { ...memoryDecisionRequest(candidate.content, evidence, candidates),
      useCase: "memory", apiKey, userId: candidate.userId, chatId: candidate.sourceChatId, messageId: candidate.sourceMessageId, requireZdr: isZdrEnabled(preferences) });
    if (!result) return undefined;
    const projected = projectMemoryDecision(result, candidates);
    if (!projected) console.warn("[m60:memory] ambiguous judgment; preserving facts separately");
    const decision: MemoryDecision = projected ?? { action: "add" as const };
    // Explicit forgetting continues through the explicit-forget entry point and existing deletion cleanup owner.
    if (decision.action === "ignore" || decision.action === "forget") return null;
    const target = decision.target;
    if (target && (typeof target.updatedAt !== "number" || !target._id)) return undefined;
    return await ctx.runMutation(internal.memory.decision_commit.commit, {
      candidate, evidence, action: decision.action,
      target: target ? { memoryId: target._id as Id<"memories">, content: target.content, updatedAt: target.updatedAt as number } : undefined,
    });
  } catch {
    console.warn("[m60:memory] decision preparation failed; using existing reconciliation");
    return undefined;
  }
}
