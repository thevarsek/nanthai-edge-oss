import { makeFunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import type {
  GenerationParticipantWorkflowArgs,
  GenerationSuccessorArgs,
} from "./workflow_events";
import { scheduleGenerationWorkflowWatchdog } from "./generation_workflow_watchdog_schedule";

interface GenerationSuccessorDeps {
  startWorkflow: (
    ctx: MutationCtx,
    args: GenerationParticipantWorkflowArgs,
  ) => Promise<string>;
  linkComponent: (
    ctx: MutationCtx,
    args: {
      runId: Id<"executionRuns">;
      attemptId: Id<"executionAttempts">;
      fence: number;
      operationId: string;
      role: string;
      userId: string;
    },
  ) => Promise<unknown>;
  scheduleWatchdog?: typeof scheduleGenerationWorkflowWatchdog;
  scheduleCleanup?: (
    ctx: MutationCtx,
    workflowId: string,
  ) => Promise<void>;
}

const completionRef = makeFunctionReference<"mutation">(
  "chat/workflow_events:reconcileGenerationWorkflowCompletion",
);

const defaultDeps: GenerationSuccessorDeps = {
  startWorkflow: async (ctx, args): Promise<string> => String(await durableWorkflow.start(
    ctx,
    internal.chat.generation_workflow.runGenerationParticipantWorkflow,
    args,
    {
      startAsync: true,
      onComplete: completionRef,
      context: { participantArgs: args },
    },
  )),
  linkComponent: async (ctx, args): Promise<unknown> => {
    const existing = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_operation", (q) =>
        q.eq("adapterId", "convex-workflow").eq("operationId", args.operationId),
      )
      .unique();
    if (existing) {
      if (existing.runId !== args.runId || existing.attemptId !== args.attemptId) {
        throw new Error("EXECUTION_COMPONENT_ALREADY_OWNED");
      }
      return existing._id;
    }
    const now = Date.now();
    return await ctx.db.insert("executionComponentRefs", {
      runId: args.runId,
      attemptId: args.attemptId,
      userId: args.userId,
      adapterId: "convex-workflow",
      operationId: args.operationId,
      role: args.role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
  scheduleWatchdog: scheduleGenerationWorkflowWatchdog,
  scheduleCleanup: async (ctx, workflowId) => {
    await ctx.scheduler.runAfter(
      60_000,
      internal.chat.workflow_events.cleanupGenerationWorkflow,
      { workflowId },
    );
  },
};

const terminalStatuses = new Set(["completed", "failed", "cancelled", "timedOut"]);

export function generationSuccessorRole(
  nextEventOffset: string,
  predecessorWorkflowId: string,
): string {
  return `generation-workflow-continuation:${nextEventOffset}:after:${predecessorWorkflowId}`;
}

export async function startGenerationSuccessorHandler(
  ctx: MutationCtx,
  args: GenerationSuccessorArgs,
  deps: GenerationSuccessorDeps = defaultDeps,
): Promise<string | null> {
  const { predecessorWorkflowId: _predecessorWorkflowId, ...workflowArgs } = args;
  const job = await ctx.db.get(args.participant.jobId);
  if (!job || terminalStatuses.has(job.status)) return null;
  if (
    !job.executionRunId
    || !job.executionAttemptId
    || job.executionFence === undefined
    || job.executionAttemptId !== args.executionAttemptId
    || job.executionFence !== args.executionFence
  ) return null;
  const [run, attempt] = await Promise.all([
    ctx.db.get(job.executionRunId),
    ctx.db.get(job.executionAttemptId),
  ]);
  if (
    !run
    || !attempt
    || run.activeAttemptId !== attempt._id
    || attempt.runId !== run._id
    || attempt.fence !== job.executionFence
    || ["completed", "failed", "cancelled"].includes(run.state)
    || run.state === "cancelling"
    || ["completed", "failed", "cancelled", "superseded"].includes(attempt.status)
  ) return null;

  const role = generationSuccessorRole(
    args.durableChain.nextEventOffset,
    args.predecessorWorkflowId,
  );
  const [existing, predecessor] = await Promise.all([
    ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_role", (q) => q.eq("runId", run._id).eq("role", role))
      .unique(),
    ctx.db
      .query("executionComponentRefs")
      .withIndex("by_operation", (q) =>
        q.eq("adapterId", "convex-workflow").eq("operationId", args.predecessorWorkflowId),
      )
      .unique(),
  ]);
  if (!predecessor || predecessor.runId !== run._id) {
    throw new Error("GENERATION_PREDECESSOR_COMPONENT_NOT_FOUND");
  }
  const completePredecessor = async (): Promise<void> => {
    if (predecessor.status === "active" || predecessor.status === "cancel_requested") {
      const now = Date.now();
      await ctx.db.patch(predecessor._id, {
        status: "completed",
        terminalAt: now,
        updatedAt: now,
      });
      await deps.scheduleCleanup?.(ctx, args.predecessorWorkflowId);
    }
  };
  if (existing) {
    await completePredecessor();
    return existing.operationId;
  }
  const workflowId = await deps.startWorkflow(ctx, workflowArgs);
  await deps.linkComponent(ctx, {
    runId: job.executionRunId,
    attemptId: job.executionAttemptId,
    fence: job.executionFence,
    operationId: workflowId,
    role,
    userId: run.userId,
  });
  await deps.scheduleWatchdog?.(ctx, {
    workflowId,
    participantArgs: workflowArgs,
  });
  await completePredecessor();
  return workflowId;
}
