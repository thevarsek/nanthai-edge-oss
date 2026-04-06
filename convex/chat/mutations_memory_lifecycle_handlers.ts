import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

export interface ReinforceMemoryArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
  reinforcedAt: number;
  candidateMemoryType?: "profile" | "responsePreference" | "workContext" | "transient";
  candidateImportanceScore?: number;
  candidateConfidenceScore?: number;
  candidateExpiresAt?: number;
}

export async function reinforceMemoryHandler(
  ctx: MutationCtx,
  args: ReinforceMemoryArgs,
): Promise<void> {
  const memory = await ctx.db.get(args.memoryId);
  if (!memory || memory.isSuperseded) return;

  const reinforcementCount = (memory.reinforcementCount ?? 1) + 1;
  const patch: Record<string, unknown> = {
    reinforcementCount,
    lastReinforcedAt: args.reinforcedAt,
    updatedAt: args.reinforcedAt,
  };

  if (
    args.candidateImportanceScore != null &&
    args.candidateImportanceScore > (memory.importanceScore ?? 0)
  ) {
    patch.importanceScore = args.candidateImportanceScore;
  }
  if (
    args.candidateConfidenceScore != null &&
    args.candidateConfidenceScore > (memory.confidenceScore ?? 0)
  ) {
    patch.confidenceScore = args.candidateConfidenceScore;
  }

  const currentType = memory.memoryType ?? "workContext";
  const nextType = args.candidateMemoryType ?? currentType;
  if (currentType !== "responsePreference" && nextType === "responsePreference") {
    patch.memoryType = nextType;
    patch.expiresAt = undefined;
  } else if (
    currentType === "transient" &&
    reinforcementCount >= 2 &&
    nextType !== "transient"
  ) {
    patch.memoryType = nextType;
    patch.expiresAt = args.candidateExpiresAt;
  } else if (
    typeof memory.expiresAt === "number" &&
    args.candidateExpiresAt != null &&
    args.candidateExpiresAt > memory.expiresAt
  ) {
    patch.expiresAt = args.candidateExpiresAt;
  }

  await ctx.db.patch(args.memoryId, patch);
}

export interface SupersedeMemoryArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
  supersededAt: number;
  supersededByMemoryId?: Id<"memories">;
}

export async function supersedeMemoryHandler(
  ctx: MutationCtx,
  args: SupersedeMemoryArgs,
): Promise<void> {
  const memory = await ctx.db.get(args.memoryId);
  if (!memory) return;

  await ctx.db.patch(args.memoryId, {
    isSuperseded: true,
    supersededByMemoryId: args.supersededByMemoryId,
    supersededAt: args.supersededAt,
    expiresAt: args.supersededAt,
    updatedAt: args.supersededAt,
  });
}

export interface TouchMemoriesArgs extends Record<string, unknown> {
  memoryIds: Id<"memories">[];
  touchedAt: number;
}

export async function touchMemoriesHandler(
  ctx: MutationCtx,
  args: TouchMemoriesArgs,
): Promise<void> {
  const uniqueIds = [...new Set(args.memoryIds)];
  for (const id of uniqueIds) {
    const memory = await ctx.db.get(id);
    if (!memory || memory.isSuperseded || memory.isPending) continue;
    await ctx.db.patch(id, {
      accessCount: (memory.accessCount ?? 0) + 1,
      lastAccessedAt: args.touchedAt,
      updatedAt: args.touchedAt,
    });
  }
}
