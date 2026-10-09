import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { internal } from "../_generated/api";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import { startWorkRun } from "./work_control";
import { wakeWorkChat } from "./wake_events";
import { workEvidence } from "./work_validators";
import { teamSettings } from "./work_validators";
import { assertAcyclicDependencies } from "./work_policy";
import {
  dependencyNodes, invalidateDependents, requireWork, requireWorkChat,
  validateWorkParticipants, workError,
} from "./work_helpers";

export const setSettings = mutation({
  args: { chatId: v.id("chats"), settings: teamSettings },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireWorkChat(ctx, userId, args.chatId);
    const { durationMinutes, maxWaves, maxPublicReplies } = args.settings;
    if (![durationMinutes, maxWaves, maxPublicReplies].every((n) => Number.isFinite(n) && n > 0)
      || !Number.isInteger(maxWaves) || !Number.isInteger(maxPublicReplies)) {
      workError("Choose a positive duration and whole-number wave and reply limits.");
    }
    const existing = await ctx.db.query("collaborationSettings")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId)).unique();
    const values = { userId, chatId: args.chatId, settings: args.settings, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("collaborationSettings", values);
    return null;
  },
});

export const createWork = mutation({
  args: {
    chatId: v.id("chats"), start: v.optional(v.boolean()), objective: v.string(), acceptanceCriteria: v.array(v.string()),
    assigneeId: v.optional(v.id("chatParticipants")), reviewerIds: v.array(v.id("chatParticipants")),
    dependencyIds: v.array(v.id("collaborationWork")), readOnlyReview: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireWorkChat(ctx, userId, args.chatId);
    if (!args.objective.trim()) workError("Describe the work objective.");
    await validateWorkParticipants(ctx, userId, args.chatId,
      [...args.reviewerIds, ...(args.assigneeId ? [args.assigneeId] : [])]);
    for (const id of args.dependencyIds) {
      const dependency = await ctx.db.get(id);
      if (!dependency || dependency.chatId !== args.chatId || dependency.userId !== userId) {
        workError("Dependencies must belong to this conversation.");
      }
    }
    const now = Date.now();
    const { start, ...values } = args;
    const id = await ctx.db.insert("collaborationWork", {
      ...values, ...(start !== undefined ? { deferred: !start } : {}), userId, objective: args.objective.trim(), requirementRevision: 1,
      revision: 1, status: "open", evidenceRevision: 0, evidence: [],
      needsRevalidation: false, linkedRunIds: [], createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("collaborationRequirements", {
      userId, chatId: args.chatId, workId: id, revision: 1,
      objective: args.objective.trim(), acceptanceCriteria: args.acceptanceCriteria,
      author: userId, createdAt: now,
    });
    if (start !== false) await wakeWorkChat(ctx, args.chatId);
    if (start) await startWorkRun(ctx, userId, args.chatId, id);
    return id;
  },
});

export const reviseWork = mutation({
  args: {
    workId: v.id("collaborationWork"), revision: v.number(), objective: v.string(),
    acceptanceCriteria: v.array(v.string()), assigneeId: v.optional(v.id("chatParticipants")),
    reviewerIds: v.array(v.id("chatParticipants")), dependencyIds: v.array(v.id("collaborationWork")),
    readOnlyReview: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const work = await requireWork(ctx, userId, args.workId, args.revision);
    if (!args.objective.trim()) workError("Describe the work objective.");
    await validateWorkParticipants(ctx, userId, work.chatId,
      [...args.reviewerIds, ...(args.assigneeId ? [args.assigneeId] : [])]);
    const rows = await ctx.db.query("collaborationWork")
      .withIndex("by_chat", (q) => q.eq("chatId", work.chatId)).collect();
    if (args.dependencyIds.some((id) => !rows.some((row) => row._id === id))) {
      workError("Dependencies must belong to this conversation.");
    }
    try { assertAcyclicDependencies(dependencyNodes(rows), String(work._id), args.dependencyIds.map(String)); }
    catch { workError("These dependencies form a cycle."); }
    const nextRevision = work.requirementRevision + 1;
    const now = Date.now();
    await ctx.db.insert("collaborationRequirements", {
      userId, chatId: work.chatId, workId: work._id, revision: nextRevision,
      objective: args.objective.trim(), acceptanceCriteria: args.acceptanceCriteria,
      author: userId, createdAt: now,
    });
    await ctx.db.patch(work._id, {
      objective: args.objective.trim(), acceptanceCriteria: args.acceptanceCriteria,
      assigneeId: args.assigneeId, reviewerIds: args.reviewerIds, dependencyIds: args.dependencyIds,
      readOnlyReview: args.readOnlyReview,
      requirementRevision: nextRevision, revision: work.revision + 1,
      needsRevalidation: work.evidence.length > 0,
      status: work.claim ? work.status : "open", blocker: undefined, updatedAt: now,
    });
    await invalidateDependents(ctx, work);
    await wakeWorkChat(ctx, work.chatId);
    return null;
  },
});

export const releaseWork = mutation({
  args: { workId: v.id("collaborationWork"), revision: v.number(), cancel: v.boolean(), reason: v.string(), start: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const work = await requireWork(ctx, userId, args.workId, args.revision);
    if (work.claim) {
      const job = await ctx.db.get(work.claim.jobId);
      if (job?.executionRunId) {
        await requestRunTreeTeardown(ctx, job.executionRunId, userId, "Work cancelled or released by owner");
        await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
          runId: job.executionRunId, requestedBy: userId, reason: "Work cancelled or released by owner",
        });
      }
    }
    await ctx.db.patch(work._id, {
      claim: undefined, pendingPublication: undefined, status: args.cancel ? "cancelled" : "open",
      blocker: args.reason || undefined, revision: work.revision + 1, updatedAt: Date.now(),
    });
    await invalidateDependents(ctx, work);
    const exchanges = await ctx.db.query("collaborationExchanges")
      .withIndex("by_chat", (q) => q.eq("chatId", work.chatId)).order("desc").take(5);
    for (const exchange of exchanges) {
      await ctx.db.patch(exchange._id, {
        failedParticipantIds: exchange.failedParticipantIds.filter((id) => id !== work.assigneeId),
      });
    }
    await wakeWorkChat(ctx, work.chatId);
    if (args.start && !args.cancel) await startWorkRun(ctx, userId, work.chatId, work._id);
    return null;
  },
});

export const publishWork = mutation({
  args: { workId: v.id("collaborationWork"), revision: v.number(), evidence: v.array(workEvidence) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const work = await requireWork(ctx, userId, args.workId, args.revision);
    if (args.evidence.length === 0) workError("Choose completed evidence for review.");
    for (const reference of args.evidence) {
      const message = await ctx.db.get(reference.messageId);
      if (!message || message.userId !== userId || message.chatId !== work.chatId
        || message.status !== "completed") workError("Evidence must be a completed message in this conversation.");
    }
    await ctx.db.patch(work._id, { evidence: args.evidence, evidenceRevision: work.evidenceRevision + 1,
      sourceRevision: args.evidence[0].sourceRevision, status: work.reviewerIds.length ? "review" : "done", needsRevalidation: false,
      claim: undefined, pendingPublication: undefined,
      revision: work.revision + 1, updatedAt: Date.now() });
    await invalidateDependents(ctx, work);
    await wakeWorkChat(ctx, work.chatId);
    return null;
  },
});
