import { v, type Infer } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { createMemoryArgs } from "../chat/mutations_args";
import { createMemoryHandler } from "../chat/mutations_internal_handlers";
import { reinforceMemoryHandler, supersedeMemoryHandler } from "../chat/mutations_memory_lifecycle_handlers";
import { isMemoryActive, normalizeMemoryRecord } from "./shared";
import { isUserDataWritable } from "../lib/write_fence";

const candidateValidator = v.object(createMemoryArgs);
export type DecisionMemoryCandidate = Infer<typeof candidateValidator>;
export interface CommitMemoryDecisionArgs {
  candidate: DecisionMemoryCandidate;
  evidence: string;
  action: "add" | "reinforce" | "supersede";
  target?: { memoryId: Id<"memories">; content: string; updatedAt: number };
}

export async function commitMemoryDecisionHandler(ctx: MutationCtx, args: CommitMemoryDecisionArgs): Promise<{ action: "add" | "reinforce" | "supersede"; memoryId: Id<"memories"> } | null> {
  const preferences = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", args.candidate.userId)).first();
  if (preferences?.isMemoryEnabled === false || preferences?.memoryGatingMode === "disabled") return null;
  const candidate = { ...args.candidate, isPending: args.candidate.isPending || preferences?.memoryGatingMode === "manualConfirm" };
  if (!candidate.sourceChatId || !candidate.sourceMessageId || !await isUserDataWritable(ctx, candidate.userId, candidate.sourceChatId)) return null;
  const message = await ctx.db.get(candidate.sourceMessageId);
  if (!message || message.userId !== candidate.userId || message.chatId !== candidate.sourceChatId || message.role !== "user" || message.content !== args.evidence) return null;
  if (message.memoryDecisionCommits?.includes(candidate.content)) return null;
  const operationKey = args.action === "add" ? candidate.content : `${args.action}:${args.target?.memoryId}`;
  if (message.memoryDecisionCommits?.includes(operationKey)) return null;
  const target = args.target ? await ctx.db.get(args.target.memoryId) : null;
  if (args.action !== "add") {
    if (!target || target.userId !== candidate.userId || !isMemoryActive(target) || target.content !== args.target?.content || target.updatedAt !== args.target.updatedAt) return null;
    if (target.sourceMessageId === candidate.sourceMessageId) return null;
    const normalized = normalizeMemoryRecord(target);
    if (normalized.scopeType !== "allPersonas" || normalized.retrievalMode === "disabled") return null;
  }
  // Pending approval and user-curated records remain separate; judgment cannot overwrite them.
  const preserve = candidate.isPending || target?.isPinned || target?.sourceType === "manual";
  if (args.action === "reinforce" && target && !preserve) {
    await reinforceMemoryHandler(ctx, { memoryId: target._id, reinforcedAt: candidate.createdAt,
      candidateImportanceScore: candidate.importanceScore, candidateConfidenceScore: candidate.confidenceScore });
    await ctx.db.patch(message._id, { memoryDecisionCommits: [...(message.memoryDecisionCommits ?? []), operationKey] });
    return { action: "reinforce" as const, memoryId: target._id };
  }
  if (args.action === "reinforce" && target && !candidate.isPending) return null;
  const memoryId = await createMemoryHandler(ctx, { ...candidate, supersedesMemoryId: args.action === "supersede" && !preserve ? target?._id : undefined });
  if (args.action === "supersede" && target && !preserve) {
    await supersedeMemoryHandler(ctx, { memoryId: target._id, supersededAt: candidate.createdAt, supersededByMemoryId: memoryId });
  }
  await ctx.db.patch(message._id, { memoryDecisionCommits: [...(message.memoryDecisionCommits ?? []), operationKey] });
  await ctx.runMutation(internal.execution.workload_queues.enqueueMemoryEmbedding, { memoryId, content: candidate.content });
  return { action: args.action === "supersede" && !preserve ? "supersede" as const : "add" as const, memoryId };
}

export const commit = internalMutation({
  args: { candidate: candidateValidator, evidence: v.string(), action: v.union(v.literal("add"), v.literal("reinforce"), v.literal("supersede")),
    target: v.optional(v.object({ memoryId: v.id("memories"), content: v.string(), updatedAt: v.number() })) },
  handler: (ctx, args) => commitMemoryDecisionHandler(ctx, args),
});
