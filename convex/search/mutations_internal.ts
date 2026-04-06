import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export interface UpsertSearchContextArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  mode: "web" | "paper";
  searchContext: unknown;
}

const TERMINAL_SESSION_STATUSES = new Set(["completed", "failed", "cancelled"]);

export const updateSearchSession = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    patch: v.any(),
  },
  handler: async (ctx, args) => {
    // Guard: prevent terminal→non-terminal transitions. Once a session
    // reaches completed/failed/cancelled, only other terminal states are
    // allowed (e.g. for late-arriving corrections).
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    const currentStatus = session.status as string;
    const incomingStatus = (args.patch as Record<string, unknown>).status as string | undefined;
    if (
      TERMINAL_SESSION_STATUSES.has(currentStatus) &&
      incomingStatus &&
      !TERMINAL_SESSION_STATUSES.has(incomingStatus)
    ) {
      console.warn(
        `[updateSearchSession] Blocked terminal→non-terminal transition: ${currentStatus} → ${incomingStatus}`,
      );
      return;
    }
    await ctx.db.patch(args.sessionId, args.patch);
  },
});

export const patchMessageSearchContext = internalMutation({
  args: {
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    mode: v.union(v.literal("web"), v.literal("paper")),
    searchContext: v.any(),
  },
  handler: upsertSearchContextForMessage,
});

export async function upsertSearchContextForMessage(
  ctx: MutationCtx,
  args: UpsertSearchContextArgs,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("searchContexts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      chatId: args.chatId,
      userId: args.userId,
      mode: args.mode,
      payload: args.searchContext,
      updatedAt: now,
    });
    // Ensure large cached payloads are not stored on hot chat message docs.
    await ctx.db.patch(args.messageId, { searchContext: undefined });
    return;
  }

  await ctx.db.insert("searchContexts", {
    messageId: args.messageId,
    chatId: args.chatId,
    userId: args.userId,
    mode: args.mode,
    payload: args.searchContext,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(args.messageId, { searchContext: undefined });
}

export const writeSearchPhase = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    phaseType: v.string(),
    phaseOrder: v.number(),
    iteration: v.optional(v.number()),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("searchPhases", {
      sessionId: args.sessionId,
      phaseType: args.phaseType as "planning" | "initial_search" | "analysis" | "depth_iteration" | "synthesis" | "paper",
      phaseOrder: args.phaseOrder,
      iteration: args.iteration,
      status: "completed",
      data: args.data,
      startedAt: Date.now(),
      completedAt: Date.now(),
    });
  },
});

export const cleanStaleSearchPhases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const BATCH_PER_STATUS = 200;

    const terminalStatuses = ["completed", "failed", "cancelled"] as const;
    const oldSessionArrays = await Promise.all(
      terminalStatuses.map((status) =>
        ctx.db
          .query("searchSessions")
          .withIndex("by_status_started", (q) =>
            q.eq("status", status).lt("startedAt", sevenDaysAgo)
          )
          .take(BATCH_PER_STATUS)
      )
    );
    const oldSessions = oldSessionArrays.flat();

    let deletedPhases = 0;
    let deletedSessions = 0;
    for (const session of oldSessions) {
      const phases = await ctx.db
        .query("searchPhases")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();

      for (const phase of phases) {
        await ctx.db.delete(phase._id);
        deletedPhases++;
      }

      // Delete the parent session row (also handles phase-less orphan sessions).
      await ctx.db.delete(session._id);
      deletedSessions++;
    }

    if (deletedPhases > 0 || deletedSessions > 0) {
      console.log(
        `Cleaned ${deletedPhases} stale search phases and ${deletedSessions} stale search sessions`,
      );
    }

    // If any status hit its batch limit, there may be more — self-schedule a continuation
    if (oldSessionArrays.some((arr) => arr.length === BATCH_PER_STATUS)) {
      await ctx.scheduler.runAfter(0, internal.search.mutations_internal.cleanStaleSearchPhases, {});
    }
  },
});
