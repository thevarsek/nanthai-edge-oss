import { mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { assertCurrentExecution } from "../execution/attempts";
import { bindRuntimeSession } from "../execution/bindings";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { assertBoundedRuntimeString } from "./security";

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

export async function resolveActiveConversationBinding(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    userId: string;
    chatParticipantId: Id<"chatParticipants">;
    routeSnapshotHash: string;
    deviceId: string;
    adapterId: string;
  },
) {
  const binding = await ctx.db.query("runtimeConversationBindings")
    .withIndex("by_participant_route_status", (queryBuilder) =>
      queryBuilder.eq("chatParticipantId", args.chatParticipantId)
        .eq("routeSnapshotHash", args.routeSnapshotHash)
        .eq("status", "active"),
    )
    .unique();
  if (
    !binding
    || binding.userId !== args.userId
    || binding.deviceId !== args.deviceId
    || binding.adapterId !== args.adapterId
  ) return null;
  return binding;
}

export async function acquireConversationBindingHandler(
  ctx: MutationCtx,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    attemptId: Id<"executionAttempts">;
    fence: number;
    nativeSessionId: string;
    threadName: string;
    now?: number;
  },
  replay?: { claimantId: string; allowExpiredLease: boolean },
): Promise<{
  conversationBindingId: Id<"runtimeConversationBindings">;
  attemptBindingId: Id<"runtimeSessionBindings">;
}> {
  const now = args.now ?? Date.now();
  assertBoundedRuntimeString(args.nativeSessionId, "Native session ID", 512);
  assertBoundedRuntimeString(args.threadName, "Native thread name", 512);
  const host = await authenticateOnlineRuntimeHost(ctx, args, now);
  const { run, attempt } = await assertCurrentExecution(ctx, {
    attemptId: args.attemptId,
    fence: args.fence,
    claimantId: replay?.claimantId ?? host.claimantId,
    allowExpiredLease: replay?.allowExpiredLease,
  });
  if (
    attempt.deviceId !== host.device.deviceId
    || !attempt.chatParticipantId
    || !attempt.routeSnapshotHash
  ) {
    throw new ConvexError({
      code: "RUNTIME_ROUTE_MISMATCH",
      message: "Execution attempt does not contain a complete local participant route",
    });
  }
  const chatParticipantId = attempt.chatParticipantId;
  const routeSnapshotHash = attempt.routeSnapshotHash;
  const participant = await ctx.db.get(chatParticipantId);
  const job = run.generationJobId ? await ctx.db.get(run.generationJobId) : null;
  const personaId = job?.effectivePersonaConfig?.personaId ?? participant?.personaId;
  if (
    !participant
    || !personaId
    || participant.chatId !== run.chatId
    || participant.userId !== run.userId
  ) {
    throw new ConvexError({
      code: "RUNTIME_PERSONA_REQUIRED",
      message: "Local conversation binding requires a Persona-backed chat participant",
    });
  }
  const existing = await ctx.db.query("runtimeConversationBindings")
    .withIndex("by_participant_route_status", (queryBuilder) =>
      queryBuilder.eq("chatParticipantId", participant._id)
        .eq("routeSnapshotHash", routeSnapshotHash)
        .eq("status", "active"),
    )
    .unique();
  const nativeOwner = await ctx.db.query("runtimeConversationBindings")
    .withIndex("by_native_session", (queryBuilder) =>
      queryBuilder.eq("deviceId", host.device.deviceId)
        .eq("adapterId", attempt.adapterId)
        .eq("nativeSessionId", args.nativeSessionId),
    )
    .unique();
  if (nativeOwner && nativeOwner._id !== existing?._id) {
    throw new ConvexError({
      code: "RUNTIME_CONVERSATION_CONFLICT",
      message: "This native conversation is already owned by another Persona route",
    });
  }
  let conversationBindingId: Id<"runtimeConversationBindings">;
  if (existing) {
    if (
      existing.nativeSessionId !== args.nativeSessionId
      || existing.deviceId !== host.device.deviceId
      || existing.adapterId !== attempt.adapterId
    ) {
      throw new ConvexError({
        code: "RUNTIME_CONVERSATION_CONFLICT",
        message: "This participant route is already bound to another native conversation",
      });
    }
    conversationBindingId = existing._id;
  } else {
    if (!run.chatId) {
      throw new ConvexError({ code: "RUNTIME_CHAT_REQUIRED", message: "Local conversation requires a chat" });
    }
    conversationBindingId = await ctx.db.insert("runtimeConversationBindings", {
      userId: run.userId,
      chatId: run.chatId,
      chatParticipantId: participant._id,
      personaId,
      participantRouteSnapshotId: attempt.participantRouteSnapshotId,
      chatRuntimeOverrideId: attempt.chatRuntimeOverrideId,
      routeSnapshotHash,
      deviceId: host.device.deviceId,
      adapterId: attempt.adapterId,
      nativeSessionId: args.nativeSessionId,
      threadName: args.threadName,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  const attemptBindingId = await bindRuntimeSession(ctx, {
    attemptId: attempt._id,
    fence: attempt.fence,
    allowExpiredLease: replay?.allowExpiredLease,
    bindingKey: `conversation:${String(conversationBindingId)}`,
    adapterId: attempt.adapterId,
    nativeSessionId: args.nativeSessionId,
    deviceId: host.device.deviceId,
    now,
  });
  await ctx.db.patch(host.credential._id, { lastUsedAt: now });
  return { conversationBindingId, attemptBindingId };
}

export const acquire = mutation({
  args: {
    ...credentialArgs,
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    nativeSessionId: v.string(),
    threadName: v.string(),
  },
  returns: v.object({
    conversationBindingId: v.id("runtimeConversationBindings"),
    attemptBindingId: v.id("runtimeSessionBindings"),
  }),
  handler: async (ctx, args) => await acquireConversationBindingHandler(ctx, args),
});

export const advanceFrontier = mutation({
  args: {
    ...credentialArgs,
    conversationBindingId: v.id("runtimeConversationBindings"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    expectedFrontierMessageId: v.optional(v.id("messages")),
    canonicalFrontierMessageId: v.id("messages"),
    nativeTurnId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await advanceConversationFrontierHandler(ctx, args),
});

export async function advanceConversationFrontierHandler(
  ctx: MutationCtx,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    conversationBindingId: Id<"runtimeConversationBindings">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    expectedFrontierMessageId?: Id<"messages">;
    canonicalFrontierMessageId: Id<"messages">;
    nativeTurnId: string;
  },
): Promise<boolean> {
    const now = Date.now();
    const host = await authenticateOnlineRuntimeHost(ctx, args, now);
    const { attempt } = await assertCurrentExecution(ctx, {
      attemptId: args.attemptId,
      fence: args.fence,
      claimantId: host.claimantId,
    });
    const binding = await ctx.db.get(args.conversationBindingId);
    if (
      !binding
      || binding.status !== "active"
      || binding.deviceId !== host.device.deviceId
      || binding.chatParticipantId !== attempt.chatParticipantId
      || binding.routeSnapshotHash !== attempt.routeSnapshotHash
    ) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Runtime conversation binding not found" });
    }
    if (binding.canonicalFrontierMessageId !== args.expectedFrontierMessageId) {
      throw new ConvexError({
        code: "RUNTIME_FRONTIER_CONFLICT",
        message: "Canonical conversation frontier changed before the native turn committed",
      });
    }
    const frontier = await ctx.db.get(args.canonicalFrontierMessageId);
    if (!frontier || frontier.chatId !== binding.chatId) {
      throw new ConvexError({ code: "VALIDATION_ERROR", message: "Frontier message is outside this chat" });
    }
    await ctx.db.patch(binding._id, {
      canonicalFrontierMessageId: frontier._id,
      lastOwnedNativeTurnId: args.nativeTurnId.slice(0, 512),
      lastSyncAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(host.credential._id, { lastUsedAt: now });
    return true;
}

export const rename = mutation({
  args: {
    ...credentialArgs,
    conversationBindingId: v.id("runtimeConversationBindings"),
    threadName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const host = await authenticateOnlineRuntimeHost(ctx, args);
    assertBoundedRuntimeString(args.threadName, "Native thread name", 512);
    const binding = await ctx.db.get(args.conversationBindingId);
    if (!binding || binding.userId !== host.device.userId || binding.status !== "active") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Runtime conversation binding not found" });
    }
    if (binding.threadName === args.threadName) return false;
    await ctx.db.patch(binding._id, { threadName: args.threadName, updatedAt: Date.now() });
    return true;
  },
});
