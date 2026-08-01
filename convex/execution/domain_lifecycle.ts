import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { claimExecutionRun } from "./attempts";
import { linkExecutionComponent } from "./component_refs";
import { heartbeatExecution, terminalizeExecution } from "./control_plane";
import { createExecutionRun } from "./runs";
import { executionComponentAdapter } from "./validators";

export const DOMAIN_EXECUTION_LEASE_MS = 24 * 60 * 60 * 1_000;

export interface DomainExecutionRef {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  claimantId: string;
}

export async function findDomainWorkflowOperation(
  ctx: MutationCtx,
  userId: string,
  runKey: string,
): Promise<string | null> {
  const run = await ctx.db
    .query("executionRuns")
    .withIndex("by_user_run_key", (query) =>
      query.eq("userId", userId).eq("runKey", runKey),
    )
    .unique();
  if (!run?.activeAttemptId) return null;
  const attempt = await ctx.db.get(run.activeAttemptId);
  return attempt?.componentOperationId ?? null;
}

export async function createAndClaimDomainExecution(
  ctx: MutationCtx,
  args: {
    userId: string;
    runKey: string;
    kind: "research" | "scheduled_job" | "advisor" | "autonomous_chat" | "remote_mcp";
    domainType: string;
    domainId: string;
    claimantId: string;
    chatId?: Id<"chats">;
    sourceMessageId?: Id<"messages">;
    generationJobId?: Id<"generationJobs">;
    parentRunId?: Id<"executionRuns">;
  },
): Promise<DomainExecutionRef> {
  const created = await createExecutionRun(ctx, {
    userId: args.userId,
    runKey: args.runKey,
    kind: args.kind,
    requestedPlacement: "cloud",
    chatId: args.chatId,
    sourceMessageId: args.sourceMessageId,
    generationJobId: args.generationJobId,
    domainType: args.domainType,
    domainId: args.domainId,
    parentRunId: args.parentRunId,
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      protocolVersion: "nanthai-execution-v1",
    },
  });
  const claimed = await claimExecutionRun(ctx, {
    runId: created.runId,
    claimantId: args.claimantId,
    leaseMs: DOMAIN_EXECUTION_LEASE_MS,
  });
  if (!claimed) throw new Error("DOMAIN_EXECUTION_NOT_CLAIMABLE");
  return { ...claimed, claimantId: args.claimantId };
}

export async function linkDomainComponent(
  ctx: MutationCtx,
  execution: DomainExecutionRef,
  args: {
    adapterId:
      | "convex-workflow"
      | "interactive-workpool"
      | "background-workpool";
    operationId: string;
    role: string;
  },
): Promise<void> {
  await linkExecutionComponent(ctx, { ...execution, ...args });
}

export async function heartbeatDomainExecution(
  ctx: MutationCtx,
  execution: DomainExecutionRef,
): Promise<void> {
  await heartbeatExecution(ctx, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    leaseMs: DOMAIN_EXECUTION_LEASE_MS,
  });
}

export async function terminalizeDomainExecution(
  ctx: MutationCtx,
  execution: DomainExecutionRef,
  outcome: "completed" | "failed" | "cancelled",
  summary: string,
): Promise<void> {
  await terminalizeExecution(ctx, { ...execution, outcome, summary });
}

export async function interruptDomainExecution(
  ctx: MutationCtx,
  execution: DomainExecutionRef,
  summary: string,
): Promise<void> {
  await terminalizeExecution(ctx, {
    ...execution,
    outcome: "interrupted",
    summary,
  });
}

const executionRefValidator = v.object({
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  claimantId: v.string(),
});

export const heartbeat = internalMutation({
  args: executionRefValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    await heartbeatDomainExecution(ctx, args);
    return null;
  },
});

export const linkComponent = internalMutation({
  args: {
    ...executionRefValidator.fields,
    adapterId: executionComponentAdapter,
    operationId: v.string(),
    role: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adapterId = args.adapterId;
    if (
      adapterId !== "convex-workflow" &&
      adapterId !== "interactive-workpool" &&
      adapterId !== "background-workpool"
    ) {
      throw new Error("UNSUPPORTED_DOMAIN_COMPONENT_ADAPTER");
    }
    await linkDomainComponent(ctx, args, {
      adapterId,
      operationId: args.operationId,
      role: args.role,
    });
    return null;
  },
});

export const terminalize = internalMutation({
  args: {
    ...executionRefValidator.fields,
    outcome: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await terminalizeDomainExecution(ctx, args, args.outcome, args.summary);
    return null;
  },
});
