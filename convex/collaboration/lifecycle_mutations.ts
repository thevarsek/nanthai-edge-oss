import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { assertCurrentFence } from "../execution/control_plane";
import { terminalizeDomainExecution } from "../execution/domain_lifecycle";
import { usageObject } from "../schema_validators";
import { recordSchedulerUsage } from "./usage";
import {
  collaborationExecutionRef,
  collaborationSelection,
  type CollaborationExecutionRef,
} from "./validators";

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function collaborationDecisionFailureMessage(
  diagnosticCategory: string,
): string | undefined {
  if (diagnosticCategory === "mentioned_participant_unavailable") {
    return "The mentioned participant is unavailable for this Collaboration.";
  }
  if (diagnosticCategory === "no_eligible_participant") {
    return "No Collaboration participant is currently available to continue.";
  }
  if (
    diagnosticCategory === "scheduler_output_truncated" ||
    diagnosticCategory === "scheduler_invalid_response"
  ) {
    return "Collaboration could not choose a participant to respond. Send a message to try again.";
  }
  return undefined;
}

export async function assertExchangeExecution(
  ctx: MutationCtx,
  exchangeId: Id<"collaborationExchanges">,
  execution: CollaborationExecutionRef,
): Promise<Doc<"collaborationExchanges">> {
  const exchange = await ctx.db.get(exchangeId);
  if (!exchange) {
    throw new Error("COLLABORATION_EXCHANGE_NOT_FOUND");
  }
  if (
    exchange.executionRunId !== execution.runId ||
    exchange.executionAttemptId !== execution.attemptId ||
    exchange.executionFence !== execution.fence ||
    exchange.executionClaimantId !== execution.claimantId
  ) {
    throw new Error("COLLABORATION_STALE_EXECUTION");
  }
  await assertCurrentFence(ctx, execution.attemptId, execution.fence);
  return exchange;
}

export const prepareWave = internalMutation({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    execution: collaborationExecutionRef,
  },
  handler: async (ctx, args) => {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    if (!["queued", "scheduling"].includes(exchange.status)) {
      return { kind: "terminal" as const, status: exchange.status };
    }
    const now = Date.now();
    const nextWave = exchange.currentWave + 1;
    const boundReached =
      nextWave > exchange.bounds.maxWaves ||
      exchange.publishedMessageCount >= exchange.bounds.maxParticipantMessages ||
      now >= exchange.bounds.deadlineAt;
    if (boundReached) {
      await ctx.db.patch(exchange._id, {
        status: "limit_reached",
        activeParticipantIds: [],
        terminalReason: "exchange_bound_reached",
        completedAt: now,
        updatedAt: now,
      });
      await terminalizeDomainExecution(
        ctx,
        args.execution,
        "completed",
        "Collaboration bound reached",
      );
      return { kind: "terminal" as const, status: "limit_reached" as const };
    }
    const frontierMessageIds = [
      ...exchange.frontierMessageIds,
      ...exchange.pendingHumanMessageIds.filter((messageId) =>
        !exchange.frontierMessageIds.includes(messageId)
      ),
    ];
    const mentionedParticipantIds = exchange.currentWave === 0
      ? [
          ...exchange.mentionedParticipantIds,
          ...exchange.pendingMentionedParticipantIds.filter((participantId) =>
            !exchange.mentionedParticipantIds.includes(participantId)
          ),
        ]
      : exchange.pendingMentionedParticipantIds;
    await ctx.db.patch(exchange._id, {
      status: "scheduling",
      currentWave: nextWave,
      frontierMessageIds,
      pendingHumanMessageIds: [],
      mentionedParticipantIds,
      pendingMentionedParticipantIds: [],
      activeParticipantIds: [],
      updatedAt: now,
    });
    return {
      kind: "ready" as const,
      wave: nextWave,
      frontierMessageIds,
    };
  },
});

export const persistDecision = internalMutation({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    wave: v.number(),
    frontierMessageIds: v.array(v.id("messages")),
    selections: v.array(collaborationSelection),
    excludedParticipantIds: v.array(v.id("chatParticipants")),
    diagnosticCategory: v.string(),
    schedulerVersion: v.string(),
    schedulerModelId: v.optional(v.string()),
    generationId: v.optional(v.string()),
    usage: v.optional(usageObject),
    execution: collaborationExecutionRef,
  },
  handler: async (ctx, args) => {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    const existing = await ctx.db
      .query("collaborationDecisions")
      .withIndex("by_exchange_wave", (query) =>
        query.eq("exchangeId", exchange._id).eq("wave", args.wave)
      )
      .unique();
    if (existing) {
      return {
        decisionId: existing._id,
        silent: existing.status === "silent" || existing.status === "failed",
      };
    }
    if (
      exchange.status !== "scheduling" ||
      exchange.currentWave !== args.wave ||
      !sameIds(exchange.frontierMessageIds.map(String), args.frontierMessageIds.map(String))
    ) {
      throw new Error("COLLABORATION_STALE_DECISION");
    }
    const available = new Set(exchange.participantSnapshot.map((participant) =>
      String(participant.participantId)
    ));
    if (args.selections.some((selection) => !available.has(String(selection.participantId)))) {
      throw new Error("COLLABORATION_INVALID_SPEAKER");
    }
    const now = Date.now();
    const decisionKey = `${String(exchange._id)}:wave:${args.wave}:${args.schedulerVersion}`;
    const usageRecordId = await recordSchedulerUsage(ctx, {
      userId: exchange.userId,
      chatId: exchange.chatId,
      messageId: exchange.initiatingMessageId,
      decisionKey,
      modelId: args.schedulerModelId,
      generationId: args.generationId,
      usage: args.usage,
      now,
    });
    const silent = args.selections.length === 0;
    const failureError = silent
      ? collaborationDecisionFailureMessage(args.diagnosticCategory)
      : undefined;
    const failed = failureError !== undefined;
    const decisionId = await ctx.db.insert("collaborationDecisions", {
      userId: exchange.userId,
      chatId: exchange.chatId,
      exchangeId: exchange._id,
      wave: args.wave,
      decisionKey,
      frontierMessageIds: args.frontierMessageIds,
      selections: args.selections,
      excludedParticipantIds: args.excludedParticipantIds,
      status: failed ? "failed" : silent ? "silent" : "selected",
      schedulerVersion: args.schedulerVersion,
      schedulerModelId: args.schedulerModelId,
      diagnosticCategory: args.diagnosticCategory,
      usageRecordId,
      createdAt: now,
      updatedAt: now,
      settledAt: silent ? now : undefined,
    });
    if (failureError) {
      await ctx.db.patch(exchange._id, {
        status: "failed",
        terminalReason: args.diagnosticCategory,
        error: failureError,
        activeParticipantIds: [],
        completedAt: now,
        updatedAt: now,
      });
      await terminalizeDomainExecution(
        ctx,
        args.execution,
        "failed",
        failureError,
      );
      return { decisionId, silent: true };
    }
    if (silent) {
      const limitReached = args.diagnosticCategory === "bound_reached";
      await ctx.db.patch(exchange._id, {
        status: limitReached ? "limit_reached" : "silent",
        terminalReason: limitReached
          ? "exchange_bound_reached"
          : args.diagnosticCategory,
        activeParticipantIds: [],
        completedAt: now,
        updatedAt: now,
      });
      await terminalizeDomainExecution(
        ctx,
        args.execution,
        "completed",
        limitReached ? "Collaboration bound reached" : "Collaboration returned the floor",
      );
    } else {
      await ctx.db.patch(exchange._id, {
        status: "dispatching",
        activeParticipantIds: args.selections.map((selection) => selection.participantId),
        updatedAt: now,
      });
    }
    return { decisionId, silent };
  },
});
