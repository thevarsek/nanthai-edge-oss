import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

export type GenerationRoundPhase =
  | "pre_dispatch"
  | "dispatched"
  | "committed"
  | "outcome_unknown";

type RoundIdentity = {
  jobId: Id<"generationJobs">;
  userId: string;
  roundKey: string;
  workflowId: string;
  eventOffset?: string;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

async function getRound(
  ctx: Pick<MutationCtx, "db">,
  jobId: Id<"generationJobs">,
  roundKey: string,
): Promise<Doc<"generationRoundJournal"> | null> {
  return await ctx.db
    .query("generationRoundJournal")
    .withIndex("by_job_round", (q) => q.eq("jobId", jobId).eq("roundKey", roundKey))
    .unique();
}

function isCurrentJob(
  job: Doc<"generationJobs"> | null,
  args: Pick<RoundIdentity, "userId" | "executionAttemptId" | "executionFence">,
): boolean {
  if (!job || job.userId !== args.userId) return false;
  if (!args.executionAttemptId) return true;
  return job.executionAttemptId === args.executionAttemptId
    && job.executionFence === args.executionFence;
}

export async function beginGenerationRoundHandler(
  ctx: MutationCtx,
  args: RoundIdentity,
): Promise<"ready" | "committed" | "outcome_unknown" | "stale"> {
  const job = await ctx.db.get(args.jobId);
  if (!job || !isCurrentJob(job, args)) return "stale";
  if (["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
    return "stale";
  }
  const existing = await getRound(ctx, args.jobId, args.roundKey);
  if (existing) {
    if (existing.phase === "pre_dispatch") return "ready";
    if (existing.phase === "committed") return "committed";
    return "outcome_unknown";
  }
  const now = Date.now();
  await ctx.db.insert("generationRoundJournal", {
    ...args,
    chatId: job.chatId,
    phase: "pre_dispatch",
    createdAt: now,
    updatedAt: now,
  });
  return "ready";
}

export async function transitionGenerationRoundHandler(
  ctx: MutationCtx,
  args: Pick<RoundIdentity, "jobId" | "userId" | "roundKey" | "executionAttemptId" | "executionFence"> & {
    phase: Exclude<GenerationRoundPhase, "pre_dispatch">;
    allowPreDispatchCommit?: boolean;
  },
): Promise<boolean> {
  const [job, round] = await Promise.all([
    ctx.db.get(args.jobId),
    getRound(ctx, args.jobId, args.roundKey),
  ]);
  if (!isCurrentJob(job, args) || !round || round.userId !== args.userId) return false;
  if (round.phase === "committed" || round.phase === "outcome_unknown") {
    return round.phase === args.phase;
  }
  if (args.phase === "dispatched") {
    if (round.phase === "dispatched") {
      return !args.executionAttemptId
        || (round.executionAttemptId === args.executionAttemptId
          && round.executionFence === args.executionFence);
    }
    if (round.phase !== "pre_dispatch") return false;
    await ctx.db.patch(round._id, {
      phase: args.phase,
      executionAttemptId: args.executionAttemptId ?? round.executionAttemptId,
      executionFence: args.executionFence ?? round.executionFence,
      updatedAt: Date.now(),
    });
    return true;
  }
  if (
    args.executionAttemptId
    && (round.executionAttemptId !== args.executionAttemptId || round.executionFence !== args.executionFence)
    && !(
      args.phase === "committed"
      && args.allowPreDispatchCommit === true
      && round.phase === "pre_dispatch"
    )
  ) return false;
  if (
    args.phase === "committed"
    && round.phase !== "dispatched"
    && !(args.allowPreDispatchCommit === true && round.phase === "pre_dispatch")
  ) return false;
  await ctx.db.patch(round._id, {
    phase: args.phase,
    ...(args.allowPreDispatchCommit === true && round.phase === "pre_dispatch"
      ? {
          executionAttemptId: args.executionAttemptId ?? round.executionAttemptId,
          executionFence: args.executionFence ?? round.executionFence,
        }
      : {}),
    updatedAt: Date.now(),
  });
  return true;
}

export async function latestGenerationRoundForWorkflow(
  ctx: Pick<MutationCtx, "db">,
  jobId: Id<"generationJobs">,
  workflowId: string,
): Promise<Doc<"generationRoundJournal"> | null> {
  return await ctx.db
    .query("generationRoundJournal")
    .withIndex("by_job_workflow_updated", (q) => q
      .eq("jobId", jobId)
      .eq("workflowId", workflowId))
    .order("desc")
    .first();
}

const roundIdentityArgs = {
  jobId: v.id("generationJobs"),
  userId: v.string(),
  roundKey: v.string(),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
};

export const beginRound = internalMutation({
  args: {
    ...roundIdentityArgs,
    workflowId: v.string(),
    eventOffset: v.optional(v.string()),
  },
  returns: v.union(
    v.literal("ready"),
    v.literal("committed"),
    v.literal("outcome_unknown"),
    v.literal("stale"),
  ),
  handler: beginGenerationRoundHandler,
});

export const markDispatched = internalMutation({
  args: roundIdentityArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => await transitionGenerationRoundHandler(ctx, {
    ...args,
    phase: "dispatched",
  }),
});

export const markCommitted = internalMutation({
  args: roundIdentityArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => await transitionGenerationRoundHandler(ctx, {
    ...args,
    phase: "committed",
  }),
});
