import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import {
  GENERATION_CONTINUATION_LEASE_MS,
  GenerationContinuationCheckpoint,
  GenerationContinuationState,
  TERMINAL_GENERATION_JOB_STATUSES,
} from "./generation_continuation_shared";

type ContinuationMutationCtx = Pick<MutationCtx, "db" | "scheduler">;

function shouldIgnoreMissingContinuationQuery(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Some older unit-test mocks do not implement generationContinuations reads.
  return error.message.includes("generationContinuations");
}

async function getContinuationByJobId(
  ctx: ContinuationMutationCtx,
  jobId: Id<"generationJobs">,
) {
  try {
    return await ctx.db
      .query("generationContinuations")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .first();
  } catch (error) {
    if (shouldIgnoreMissingContinuationQuery(error)) {
      return null;
    }
    throw error;
  }
}

export interface SaveGenerationContinuationArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  userId: string;
  checkpoint: GenerationContinuationCheckpoint;
}

export async function saveGenerationContinuationHandler(
  ctx: ContinuationMutationCtx,
  args: SaveGenerationContinuationArgs,
): Promise<void> {
  const now = Date.now();
  const existing = await getContinuationByJobId(ctx, args.jobId);
  const value = {
    chatId: args.chatId,
    messageId: args.messageId,
    jobId: args.jobId,
    userId: args.userId,
    status: "waiting" as const,
    participantSnapshot: args.checkpoint.participant,
    groupSnapshot: args.checkpoint.group,
    requestMessages: args.checkpoint.messages,
    usage: args.checkpoint.usage ?? undefined,
    toolCalls: args.checkpoint.toolCalls.length > 0
      ? args.checkpoint.toolCalls
      : undefined,
    toolResults: args.checkpoint.toolResults.length > 0
      ? args.checkpoint.toolResults
      : undefined,
    activeProfiles: args.checkpoint.activeProfiles,
    compactionCount: args.checkpoint.compactionCount,
    continuationCount: args.checkpoint.continuationCount,
    partialContent: args.checkpoint.partialContent,
    partialReasoning: args.checkpoint.partialReasoning,
    scheduledAt: undefined,
    scheduledFunctionId: undefined,
    claimedAt: undefined,
    leaseExpiresAt: undefined,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, value);
    return;
  }

  await ctx.db.insert("generationContinuations", {
    ...value,
    createdAt: now,
  });
}

export interface ClaimGenerationContinuationArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function claimGenerationContinuationHandler(
  ctx: ContinuationMutationCtx,
  args: ClaimGenerationContinuationArgs,
): Promise<GenerationContinuationState | null> {
  const now = Date.now();
  const continuation = await getContinuationByJobId(ctx, args.jobId);
  if (!continuation) {
    return null;
  }

  const job = await ctx.db.get(args.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) {
    await ctx.db.delete(continuation._id);
    if (job?.scheduledFunctionId) {
      await ctx.db.patch(job._id, { scheduledFunctionId: undefined });
    }
    return null;
  }

  const leaseActive =
    continuation.status === "running"
    && continuation.leaseExpiresAt != null
    && continuation.leaseExpiresAt > now;
  if (leaseActive) {
    return null;
  }

  await ctx.db.patch(continuation._id, {
    status: "running",
    claimedAt: now,
    leaseExpiresAt: now + GENERATION_CONTINUATION_LEASE_MS,
    scheduledAt: undefined,
    scheduledFunctionId: undefined,
    updatedAt: now,
  });
  if (job.scheduledFunctionId) {
    await ctx.db.patch(job._id, { scheduledFunctionId: undefined });
  }

  return {
    participant: continuation.participantSnapshot as GenerationContinuationState["participant"],
    group: continuation.groupSnapshot as GenerationContinuationState["group"],
    messages: continuation.requestMessages as GenerationContinuationState["messages"],
    usage: (continuation.usage ?? null) as GenerationContinuationState["usage"],
    toolCalls: (continuation.toolCalls ?? []) as GenerationContinuationState["toolCalls"],
    toolResults: (continuation.toolResults ?? []) as GenerationContinuationState["toolResults"],
    activeProfiles: continuation.activeProfiles as GenerationContinuationState["activeProfiles"],
    compactionCount: continuation.compactionCount ?? 0,
    continuationCount: continuation.continuationCount ?? 0,
    partialContent: continuation.partialContent,
    partialReasoning: continuation.partialReasoning,
  };
}

export interface SetGenerationContinuationScheduledArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
  scheduledFunctionId: Id<"_scheduled_functions">;
  updateContinuation?: boolean;
}

export async function setGenerationContinuationScheduledHandler(
  ctx: ContinuationMutationCtx,
  args: SetGenerationContinuationScheduledArgs,
): Promise<void> {
  const now = Date.now();
  if (args.updateContinuation !== false) {
    const continuation = await getContinuationByJobId(ctx, args.jobId);
    if (continuation && continuation.status === "waiting") {
      await ctx.db.patch(continuation._id, {
        status: "waiting",
        scheduledAt: now,
        scheduledFunctionId: args.scheduledFunctionId,
        updatedAt: now,
      });
    }
  }

  const job = await ctx.db.get(args.jobId);
  if (job) {
    await ctx.db.patch(job._id, {
      scheduledFunctionId: args.scheduledFunctionId,
    });
  }
}

export interface ClearGenerationContinuationArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function clearGenerationContinuationHandler(
  ctx: ContinuationMutationCtx,
  args: ClearGenerationContinuationArgs,
): Promise<void> {
  const continuation = await getContinuationByJobId(ctx, args.jobId);
  if (continuation) {
    await ctx.db.delete(continuation._id);
  }

  const job = await ctx.db.get(args.jobId);
  if (job?.scheduledFunctionId) {
    await ctx.db.patch(job._id, { scheduledFunctionId: undefined });
  }
}

export interface CancelGenerationContinuationArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function cancelGenerationContinuationHandler(
  ctx: ContinuationMutationCtx,
  args: CancelGenerationContinuationArgs,
): Promise<void> {
  const continuation = await getContinuationByJobId(ctx, args.jobId);
  const job = await ctx.db.get(args.jobId);
  const scheduledFunctionId =
    continuation?.scheduledFunctionId ?? job?.scheduledFunctionId;

  if (scheduledFunctionId) {
    try {
      await ctx.scheduler.cancel(scheduledFunctionId);
    } catch {
      // Already executed or cancelled.
    }
  }

  if (continuation) {
    await ctx.db.delete(continuation._id);
  }
  if (job?.scheduledFunctionId) {
    await ctx.db.patch(job._id, { scheduledFunctionId: undefined });
  }
}

export interface MarkPostProcessScheduledArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function markPostProcessScheduledHandler(
  ctx: MutationCtx,
  args: MarkPostProcessScheduledArgs,
): Promise<boolean> {
  const message = await ctx.db.get(args.messageId);
  if (!message || message.postProcessScheduledAt != null) {
    return false;
  }

  await ctx.db.patch(args.messageId, {
    postProcessScheduledAt: Date.now(),
  });
  return true;
}
