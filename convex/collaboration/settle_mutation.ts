import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { terminalizeDomainExecution } from "../execution/domain_lifecycle";
import {
  collaborationExecutionRef,
  type CollaborationExecutionRef,
} from "./validators";
import { assertExchangeExecution } from "./lifecycle_mutations";

const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

export async function settleDecisionHandler(
  ctx: MutationCtx,
  args: {
    exchangeId: Id<"collaborationExchanges">;
    decisionId: Id<"collaborationDecisions">;
    execution: CollaborationExecutionRef;
  },
) {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    const decision = await ctx.db.get(args.decisionId);
    if (!decision || decision.exchangeId !== exchange._id) {
      throw new Error("COLLABORATION_DECISION_NOT_FOUND");
    }
    if (decision.status === "settled") return { terminal: false };
    if (decision.status !== "dispatched" || !decision.generationJobIds) {
      throw new Error("COLLABORATION_DECISION_NOT_DISPATCHED");
    }
    const jobs = await Promise.all(
      decision.generationJobIds.map((jobId) => ctx.db.get(jobId)),
    );
    if (jobs.some((job) => !job || !TERMINAL_JOB_STATUSES.has(job.status))) {
      return { terminal: false, pending: true };
    }
    const messages = await Promise.all(
      (decision.assistantMessageIds ?? []).map((messageId) => ctx.db.get(messageId)),
    );
    const successfulMessageIds = messages
      .filter((message) => message?.status === "completed")
      .map((message) => message!._id);
    const failedParticipantIds = jobs
      .filter((job) => job?.status !== "completed")
      .flatMap((job) => job?.chatParticipantId ? [job.chatParticipantId] : []);
    const allSelectedFailed =
      successfulMessageIds.length === 0 && failedParticipantIds.length > 0;
    const now = Date.now();
    const allFailedParticipants = [
      ...exchange.failedParticipantIds,
      ...failedParticipantIds.filter((participantId) =>
        !exchange.failedParticipantIds.includes(participantId)
      ),
    ];
    const pendingHumanMessageIds = [...exchange.pendingHumanMessageIds];
    const nextFrontier = [
      ...successfulMessageIds,
      ...pendingHumanMessageIds.filter((messageId) =>
        !successfulMessageIds.includes(messageId)
      ),
    ];
    for (const pendingMessageId of pendingHumanMessageIds) {
      const pendingMessage = await ctx.db.get(pendingMessageId);
      if (!pendingMessage || pendingMessage.chatId !== exchange.chatId) continue;
      await ctx.db.patch(pendingMessage._id, {
        parentMessageIds: [
          ...pendingMessage.parentMessageIds,
          ...successfulMessageIds.filter((messageId) =>
            !pendingMessage.parentMessageIds.includes(messageId)
          ),
        ],
      });
    }
    await ctx.db.patch(decision._id, {
      status: "settled",
      successfulMessageIds,
      failedParticipantIds,
      updatedAt: now,
      settledAt: now,
    });
    const allParticipantsFailed =
      allSelectedFailed &&
      allFailedParticipants.length >= exchange.participantSnapshot.length;
    if (allParticipantsFailed) {
      await ctx.db.patch(exchange._id, {
        status: "failed",
        activeParticipantIds: [],
        failedParticipantIds: allFailedParticipants,
        publishedMessageCount:
          exchange.publishedMessageCount + (decision.assistantMessageIds?.length ?? 0),
        terminalReason: "all_participants_failed",
        error: "Every Collaboration participant is unavailable or failed.",
        completedAt: now,
        updatedAt: now,
      });
      await terminalizeDomainExecution(
        ctx,
        args.execution,
        "failed",
        "Every Collaboration participant failed",
      );
      return { terminal: true, status: "failed" as const };
    }
    await ctx.db.patch(exchange._id, {
      status: "queued",
      activeParticipantIds: [],
      failedParticipantIds: allFailedParticipants,
      publishedMessageCount:
        exchange.publishedMessageCount + (decision.assistantMessageIds?.length ?? 0),
      frontierMessageIds: nextFrontier.length > 0
        ? nextFrontier
        : exchange.frontierMessageIds,
      pendingHumanMessageIds: [],
      updatedAt: now,
    });
    const latestPendingHumanMessageId = pendingHumanMessageIds.at(-1);
    if (latestPendingHumanMessageId) {
      const chat = await ctx.db.get(exchange.chatId);
      if (chat) {
        await ctx.db.patch(chat._id, {
          activeBranchLeafId: latestPendingHumanMessageId,
          activeBranchLeafFocusOrder: undefined,
          updatedAt: now,
        });
      }
    }
  return { terminal: false, pending: false };
}

export const settleDecision = internalMutation({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    decisionId: v.id("collaborationDecisions"),
    execution: collaborationExecutionRef,
  },
  handler: settleDecisionHandler,
});
