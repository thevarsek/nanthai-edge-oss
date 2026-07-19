import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  createAndClaimDomainExecution,
  heartbeatDomainExecution,
  linkDomainComponent,
  terminalizeDomainExecution,
  type DomainExecutionRef,
} from "../execution/domain_lifecycle";

export function researchExecutionRef(
  session: Doc<"searchSessions">,
): DomainExecutionRef | null {
  if (
    !session.executionRunId ||
    !session.executionAttemptId ||
    session.executionFence === undefined ||
    !session.executionClaimantId
  )
    return null;
  return {
    runId: session.executionRunId,
    attemptId: session.executionAttemptId,
    fence: session.executionFence,
    claimantId: session.executionClaimantId,
  };
}

export interface ResearchExecutionToken {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}

type ReadCtx = Pick<MutationCtx | QueryCtx, "db">;

export async function isCurrentResearchExecution(
  ctx: ReadCtx,
  session: Doc<"searchSessions">,
  token: ResearchExecutionToken,
  allowTerminalSession = false,
): Promise<boolean> {
  const { executionAttemptId, executionFence } = token;
  const hasAttempt = executionAttemptId !== undefined;
  const hasFence = executionFence !== undefined;
  if (!hasAttempt && !hasFence) {
    return allowTerminalSession || session.status !== "cancelled";
  }
  if (!hasAttempt || !hasFence) return false;
  if (
    (!allowTerminalSession
      && ["completed", "failed", "cancelled"].includes(session.status))
    || session.executionAttemptId !== executionAttemptId
    || session.executionFence !== executionFence
  ) return false;
  if (executionAttemptId === undefined || executionFence === undefined) return false;
  const attempt = await ctx.db.get(executionAttemptId);
  if (!attempt || attempt.status !== "running" || attempt.fence !== executionFence) {
    return false;
  }
  const run = await ctx.db.get(attempt.runId);
  return Boolean(
    run
    && run.activeAttemptId === attempt._id
    && run.state === "running"
    && attempt.claimantId === session.executionClaimantId,
  );
}

export async function heartbeatResearchSession(
  ctx: MutationCtx,
  session: Doc<"searchSessions">,
): Promise<void> {
  const execution = researchExecutionRef(session);
  if (execution) await heartbeatDomainExecution(ctx, execution);
}

export async function cancelResearchSessionExecution(
  ctx: MutationCtx,
  session: Doc<"searchSessions">,
): Promise<void> {
  const execution = researchExecutionRef(session);
  if (execution) {
    await terminalizeDomainExecution(
      ctx,
      execution,
      "cancelled",
      "Research paper cancelled by user",
    );
  }
}

export const initializeResearchExecution = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    jobId: v.id("generationJobs"),
    workflowId: v.string(),
    parentExecutionRunId: v.optional(v.id("executionRuns")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("RESEARCH_SESSION_NOT_FOUND");
    const existing = researchExecutionRef(session);
    if (existing) {
      await heartbeatDomainExecution(ctx, existing);
      return null;
    }
    const job = await ctx.db.get(args.jobId);
    const claimantId = `research-workflow:${args.workflowId}`;
    const execution = await createAndClaimDomainExecution(ctx, {
      userId: session.userId,
      runKey: `research:${String(session._id)}:${args.workflowId}`,
      kind: "research",
      domainType: "search_session",
      domainId: String(session._id),
      claimantId,
      chatId: session.chatId,
      sourceMessageId: session.assistantMessageId,
      generationJobId: args.jobId,
      parentRunId: args.parentExecutionRunId ?? job?.executionRunId,
    });
    await linkDomainComponent(ctx, execution, {
      adapterId: "convex-workflow",
      operationId: args.workflowId,
      role: "research-paper-workflow",
    });
    await ctx.db.patch(session._id, {
      workflowId: args.workflowId,
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      executionClaimantId: claimantId,
    });
    return null;
  },
});

export const heartbeatResearchExecution = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session && await isCurrentResearchExecution(ctx, session, args)) {
      await heartbeatResearchSession(ctx, session);
    }
    return null;
  },
});

export const terminalizeResearchExecution = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    outcome: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    summary: v.string(),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const execution = session && await isCurrentResearchExecution(ctx, session, args, true)
      ? researchExecutionRef(session)
      : null;
    if (execution) {
      await terminalizeDomainExecution(
        ctx,
        execution,
        args.outcome,
        args.summary,
      );
    }
    return null;
  },
});

export const terminalizeResearchFailure = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    summary: v.string(),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const isCurrent = session
      ? await isCurrentResearchExecution(ctx, session, args, true)
      : false;
    const execution = session && isCurrent ? researchExecutionRef(session) : null;
    if (execution) {
      await terminalizeDomainExecution(
        ctx,
        execution,
        session?.status === "cancelled" ? "cancelled" : "failed",
        args.summary,
      );
    }
    if (
      session && isCurrent &&
      session.status !== "completed" &&
      session.status !== "cancelled"
    ) {
      await ctx.db.patch(session._id, {
        status: "failed",
        currentPhase: "failed",
        errorMessage: args.summary.slice(0, 2_000),
        completedAt: Date.now(),
      });
    }
    return null;
  },
});

export async function linkResearchWorkpoolOperation(
  ctx: MutationCtx,
  sessionId: Id<"searchSessions">,
  operationId: string,
  role: string,
): Promise<void> {
  const session = await ctx.db.get(sessionId);
  const execution = session ? researchExecutionRef(session) : null;
  if (!execution) return;
  await linkDomainComponent(ctx, execution, {
    adapterId: "interactive-workpool",
    operationId,
    role,
  });
}
