import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { collaborationExecutionRef } from "./validators";
import { assertExchangeExecution } from "./lifecycle_mutations";
import { workExecutionBlocker } from "./work_execution_policy";
import { eligibleWork } from "./work_context";
import { terminalizeDomainExecution } from "../execution/domain_lifecycle";
import { internal } from "../_generated/api";
import { requestRunTreeTeardown } from "../execution/teardown_graph";

const terminalJobs = new Set(["completed", "failed", "cancelled", "timedOut"]);

export const observeProgress = internalMutation({
  args: { exchangeId: v.id("collaborationExchanges"), execution: collaborationExecutionRef },
  handler: async (ctx, args) => {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    const now = Date.now();
    if (["silent", "completed", "limit_reached", "stopped", "failed"].includes(exchange.status)) {
      return { kind: "terminal" as const };
    }
    if (now >= exchange.bounds.deadlineAt) {
      await ctx.db.patch(exchange._id, { status: "limit_reached", terminalReason: "exchange_bound_reached",
        completedAt: now, updatedAt: now });
      await requestRunTreeTeardown(ctx, args.execution.runId, exchange.userId, "Collaboration duration reached");
      await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
        runId: args.execution.runId, requestedBy: exchange.userId, reason: "Collaboration duration reached",
      });
      return { kind: "terminal" as const };
    }
    if (!exchange.workEnabled) {
      const decisions = await ctx.db.query("collaborationDecisions")
        .withIndex("by_exchange_wave", (q) => q.eq("exchangeId", exchange._id)).order("desc").take(1);
      const decision = decisions[0];
      if (!decision || decision.status === "settled") {
        await ctx.db.patch(exchange._id, { status: "queued" });
        return { kind: "ready" as const };
      }
      const jobs = await Promise.all((decision.generationJobIds ?? []).map((id) => ctx.db.get(id)));
      const messages = await Promise.all(jobs.map((job) => job ? ctx.db.get(job.messageId) : null));
      return jobs.every((job, index) => job && terminalJobs.has(job.status)
        && (job.status !== "completed" || messages[index]?.status === "completed"))
        ? { kind: "settle" as const, decisionId: decision._id } : { kind: "wait" as const };
    }
    const decisions = await ctx.db.query("collaborationDecisions")
      .withIndex("by_exchange_wave", (q) => q.eq("exchangeId", exchange._id)).collect();
    const committed = new Set(exchange.frontierMessageIds);
    const active = new Set<NonNullable<typeof exchange.activeParticipantIds>[number]>();
    const failed = new Set(exchange.failedParticipantIds);
    let publicReplies = exchange.publishedMessageCount;
    let reserved = 0;
    for (const decision of decisions) {
      if (decision.status !== "dispatched") continue;
      const jobs = await Promise.all((decision.generationJobIds ?? []).map((id) => ctx.db.get(id)));
      const accounted = new Set(decision.accountedJobIds ?? []);
      const successful = new Set(decision.successfulMessageIds ?? []);
      const failedSpeakers = new Set(decision.failedParticipantIds ?? []);
      let settled = true;
      for (const job of jobs) {
        if (!job) continue;
        const message = await ctx.db.get(job.messageId);
        if (!terminalJobs.has(job.status) || (job.status === "completed" && message
          && !["completed", "failed", "cancelled"].includes(message.status))) {
          settled = false;
          reserved += 1;
          if (job.chatParticipantId) active.add(job.chatParticipantId);
          continue;
        }
        if (accounted.has(job._id)) continue;
        accounted.add(job._id);
        publicReplies += 1;
        if (job.status === "completed" && message?.status === "completed") {
          committed.add(message._id); successful.add(message._id);
        } else if (job.chatParticipantId) {
          failed.add(job.chatParticipantId); failedSpeakers.add(job.chatParticipantId);
        }
      }
      await ctx.db.patch(decision._id, { accountedJobIds: [...accounted],
        successfulMessageIds: [...successful], failedParticipantIds: [...failedSpeakers],
        status: settled ? "settled" : "dispatched", settledAt: settled ? now : undefined, updatedAt: now });
    }
    const humanInput = exchange.pendingHumanMessageIds.length > 0;
    for (const id of exchange.pendingHumanMessageIds) committed.add(id);
    await ctx.db.patch(exchange._id, { frontierMessageIds: [...committed],
      activeParticipantIds: [...active], failedParticipantIds: [...failed],
      publishedMessageCount: publicReplies, pendingHumanMessageIds: [], updatedAt: now });
    const { rows, candidates } = await eligibleWork(ctx, exchange.chatId, exchange.workIds);
    if (rows.every((row) => row.status === "done" || row.status === "cancelled") && active.size === 0) {
      if (humanInput) {
        await ctx.db.patch(exchange._id, { workEnabled: false, status: "queued" });
        return { kind: "ready" as const };
      }
      await ctx.db.patch(exchange._id, { status: "completed", terminalReason: "work_criteria_met",
        completedAt: now, updatedAt: now });
      await terminalizeDomainExecution(ctx, args.execution, "completed", "Declared work criteria met");
      return { kind: "terminal" as const };
    }
    const ready = (humanInput && exchange.participantSnapshot.some(p => !active.has(p.participantId) && !failed.has(p.participantId))) || candidates.some((row) => (row.status === "review" ? row.pendingReviewerIds : row.assigneeId ? [row.assigneeId] : exchange.participantSnapshot.map(p => p.participantId))
      .some((id) => !active.has(id) && !failed.has(id)));
    const canDispatch = exchange.currentWave < exchange.bounds.maxWaves
      && publicReplies + reserved < exchange.bounds.maxParticipantMessages;
    const boundReached = exchange.currentWave >= exchange.bounds.maxWaves
      || publicReplies >= exchange.bounds.maxParticipantMessages;
    if ((ready && canDispatch) || (boundReached && active.size === 0)) {
      await ctx.db.patch(exchange._id, { status: "queued" });
      return { kind: "ready" as const };
    }
    await ctx.db.patch(exchange._id, { status: "waiting" });
    return { kind: "wait" as const };
  },
});

export const selectWorkSpeakers = internalMutation({
  args: { exchangeId: v.id("collaborationExchanges"), execution: collaborationExecutionRef },
  handler: async (ctx, args) => {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    if (!exchange.workEnabled) return null;
    const { candidates } = await eligibleWork(ctx, exchange.chatId, exchange.workIds);
    const human = await Promise.all(exchange.frontierMessageIds.map(id => ctx.db.get(id)));
    const unanswered = human.some(row => row?.role === "user" && !human.some(reply => reply?.role === "assistant" && reply.parentMessageIds.includes(row._id)));
    const available = exchange.participantSnapshot.some(p => !exchange.activeParticipantIds.includes(p.participantId) && !exchange.failedParticipantIds.includes(p.participantId));
    if (available && (unanswered || candidates.some(row => row.status === "open" && !row.assigneeId))) return null;
    const selections: Array<{ participantId: typeof exchange.activeParticipantIds[number];
      replyToMessageIds: typeof exchange.frontierMessageIds; reasonCode: string; workId: Doc<"collaborationWork">["_id"] }> = [];
    const occupied = new Set([...exchange.activeParticipantIds, ...exchange.failedParticipantIds]);
    const pendingDecisions = await ctx.db.query("collaborationDecisions")
      .withIndex("by_exchange_wave", (q) => q.eq("exchangeId", exchange._id)).collect();
    const reserved = pendingDecisions.filter((row) => row.status === "dispatched")
      .reduce((count, row) => count + (row.generationJobIds?.length ?? 0) - (row.accountedJobIds?.length ?? 0), 0);
    const budget = exchange.bounds.maxParticipantMessages - exchange.publishedMessageCount - reserved;
    let runtimeWait = false;
    for (const work of candidates) {
      if (selections.length >= budget) break;
      const ids = work.status === "review" ? work.pendingReviewerIds : work.assigneeId ? [work.assigneeId] : [];
      const participantId = ids.find((id) => !occupied.has(id)
        && exchange.participantSnapshot.some((row) => row.participantId === id));
      if (!participantId) continue;
      const blocker = await workExecutionBlocker(ctx, work, participantId);
      if (blocker === "Waiting for your Mac.") { runtimeWait = true; continue; }
      if (blocker) {
        await ctx.db.patch(work._id, { status: "blocked", blocker, revision: work.revision + 1, updatedAt: Date.now() });
        continue;
      }
      occupied.add(participantId);
      selections.push({ participantId, workId: work._id, replyToMessageIds: exchange.frontierMessageIds,
        reasonCode: work.status === "review" ? "review_work" : "owned_work" });
    }
    return { selections, excludedParticipantIds: [], diagnosticCategory: runtimeWait ? "local_runtime_unavailable" : "work_assignment",
      schedulerVersion: "work-records-v1" };
  },
});
