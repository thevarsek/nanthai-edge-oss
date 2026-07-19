import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { RunEventType } from "./validators";

export interface AppendRunEventArgs {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  type: RunEventType;
  summary: string;
  phase?: string;
  progress?: number;
  artifactIds?: string[];
  privacyClass?: string;
  adapterDetail?: string;
  eventId?: string;
  now?: number;
}

function boundedProgress(progress: number | undefined): number | undefined {
  if (progress === undefined || !Number.isFinite(progress)) return undefined;
  return Math.max(0, Math.min(1, progress));
}

export async function appendRunEventUnchecked(
  ctx: MutationCtx,
  run: Doc<"executionRuns">,
  args: Omit<AppendRunEventArgs, "runId">,
): Promise<Id<"runEvents">> {
  const now = args.now ?? Date.now();
  const sequence = run.nextEventSequence;
  const eventId = args.eventId ?? `${String(args.attemptId)}:${sequence}:${args.type}`;
  const existing = await ctx.db
    .query("runEvents")
    .withIndex("by_attempt_event", (q) =>
      q.eq("attemptId", args.attemptId).eq("eventId", eventId),
    )
    .unique();
  if (existing) {
    const requested = {
      runId: run._id,
      attemptId: args.attemptId,
      fence: args.fence,
      type: args.type,
      summary: args.summary.slice(0, 2_000),
      phase: args.phase?.slice(0, 200),
      progress: boundedProgress(args.progress),
      artifactIds: args.artifactIds?.slice(0, 100),
      privacyClass: args.privacyClass?.slice(0, 100),
      adapterDetail: args.adapterDetail?.slice(0, 4_000),
    };
    const conflict = existing.runId !== requested.runId
      || existing.fence !== requested.fence
      || existing.type !== requested.type
      || existing.summary !== requested.summary
      || existing.phase !== requested.phase
      || existing.progress !== requested.progress
      || JSON.stringify(existing.artifactIds) !== JSON.stringify(requested.artifactIds)
      || existing.privacyClass !== requested.privacyClass
      || existing.adapterDetail !== requested.adapterDetail;
    if (args.eventId && conflict) throw new Error("RUN_EVENT_IDEMPOTENCY_CONFLICT");
    return existing._id;
  }
  const id = await ctx.db.insert("runEvents", {
    runId: run._id,
    attemptId: args.attemptId,
    userId: run.userId,
    eventId,
    fence: args.fence,
    sequence,
    type: args.type,
    summary: args.summary.slice(0, 2_000),
    phase: args.phase?.slice(0, 200),
    progress: boundedProgress(args.progress),
    artifactIds: args.artifactIds?.slice(0, 100),
    privacyClass: args.privacyClass?.slice(0, 100),
    adapterDetail: args.adapterDetail?.slice(0, 4_000),
    createdAt: now,
  });
  await ctx.db.patch(run._id, {
    nextEventSequence: sequence + 1,
    updatedAt: now,
  });
  return id;
}
