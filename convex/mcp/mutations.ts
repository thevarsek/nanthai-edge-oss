import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import { assertUserDataWritable } from "../lib/write_fence";
import { boundedText } from "./policy";
import {
  cleanupConnectionReferencePage,
  connectionReferenceCleanupPhases,
} from "./connection_references";
import { deleteDisconnectableInvocationPage } from "./connection_invocation_cleanup";
import { mcpCredentialAuthMode, storeMcpCredential } from "./credential_mutation";

export const createConnection = internalMutation({
  args: {
    userId: v.string(),
    publicId: v.string(),
    endpoint: v.string(),
    endpointOrigin: v.string(),
    endpointHost: v.string(),
    friendlyName: v.optional(v.string()),
    authMode: mcpCredentialAuthMode,
  },
  handler: async (ctx, args) => {
    await assertUserDataWritable(ctx, args.userId);
    const now = Date.now();
    return await ctx.db.insert("mcpConnections", {
      ...args,
      integrationId: `mcp:${args.publicId}`,
      status: "validating",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const storeCredential = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    authMode: mcpCredentialAuthMode,
    issuerOrOrigin: v.string(),
    resourceOrigin: v.string(),
    apiKeyHeader: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    credentialValue: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    tokenEndpoint: v.optional(v.string()),
    revocationEndpoint: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    expiresAt: v.optional(v.number()),
    expectedOAuthStateHash: v.optional(v.string()),
  },
  handler: storeMcpCredential,
});

export const markConnectionFailure = internalMutation({
  args: {
    connectionId: v.id("mcpConnections"),
    status: v.union(v.literal("auth_required"), v.literal("unsupported"), v.literal("error")),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      status: args.status,
      lastErrorCode: args.errorCode,
      lastCheckedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setConnectionStatus = internalMutation({
  args: {
    connectionId: v.id("mcpConnections"),
    userId: v.string(),
    status: v.union(v.literal("authorizing"), v.literal("validating"), v.literal("auth_required")),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.userId !== args.userId) throw new Error("MCP connection missing.");
    await ctx.db.patch(connection._id, { status: args.status, updatedAt: Date.now() });
    return null;
  },
});

export const setItemDecision = mutation({
  args: {
    connectionId: v.string(),
    stableKey: v.string(),
    decision: v.union(v.literal("allowed"), v.literal("disabled")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.decision === "allowed") await requirePro(ctx, userId);
    const connection = await ctx.db
      .query("mcpConnections")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", userId).eq("publicId", args.connectionId),
      )
      .unique();
    if (!connection) throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP server not found." });
    const item = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_stable_key", (q) =>
        q.eq("connectionId", connection._id).eq("stableKey", args.stableKey),
      )
      .unique();
    if (!item || item.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP item not found." });
    }
    if (args.decision === "allowed" && item.disabledReason) {
      throw new ConvexError({ code: "MCP_ITEM_UNSUPPORTED", message: "This item cannot be enabled safely." });
    }
    await ctx.db.patch(item._id, { decision: args.decision, updatedAt: Date.now() });
    return null;
  },
});

export const setConnectionEnabled = mutation({
  args: { connectionId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.enabled) await requirePro(ctx, userId);
    const connection = await ctx.db
      .query("mcpConnections")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", userId).eq("publicId", args.connectionId),
      )
      .unique();
    if (!connection) throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP server not found." });
    if (args.enabled && !connection.protocolVersion) {
      throw new ConvexError({ code: "MCP_NOT_READY", message: "Refresh this server before enabling it." });
    }
    await ctx.db.patch(connection._id, {
      status: args.enabled ? "active" : "disabled",
      updatedAt: Date.now(),
    });
    if (!args.enabled) {
      await ctx.scheduler.runAfter(0, internal.mcp.lifecycle_mutations.cancelConnectionInvocations, {
        userId,
        connectionId: connection._id,
        reason: "Remote MCP server was disabled.",
      });
    }
    return null;
  },
});

export const setConnectionFriendlyName = mutation({
  args: {
    connectionId: v.string(),
    friendlyName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const connection = await ctx.db
      .query("mcpConnections")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", userId).eq("publicId", args.connectionId),
      )
      .unique();
    if (!connection) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP server not found." });
    }
    const friendlyName = boundedText(args.friendlyName, 100);
    await ctx.db.patch(connection._id, {
      friendlyName,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const beginConnectionDisconnect = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.userId !== args.userId) return null;
    await ctx.db.patch(connection._id, { status: "disconnecting", updatedAt: Date.now() });
    const credential = await ctx.db
      .query("mcpCredentials")
      .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
      .unique();
    if (credential) await ctx.db.delete(credential._id);
    const transactions = await ctx.db
      .query("mcpOAuthTransactions")
      .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
      .take(50);
    for (const transaction of transactions) await ctx.db.delete(transaction._id);
    return null;
  },
});

export const deleteConnectionData = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    scheduleRemainder: v.optional(v.boolean()),
    referencesCleaned: v.optional(v.boolean()),
    referenceCleanupPhase: v.optional(v.union(
      v.literal(connectionReferenceCleanupPhases[0]),
      v.literal(connectionReferenceCleanupPhases[1]),
      v.literal(connectionReferenceCleanupPhases[2]),
      v.literal(connectionReferenceCleanupPhases[3]),
      v.literal(connectionReferenceCleanupPhases[4]),
    )),
    referenceCleanupCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.userId !== args.userId) return null;
    await ctx.db.patch(connection._id, { status: "disconnecting", updatedAt: Date.now() });
    const batchSize = 50;
    const scheduleNext = async (nextArgs: Record<string, unknown> = {}) => {
      if (args.scheduleRemainder !== false) {
        await ctx.scheduler.runAfter(0, internal.mcp.mutations.deleteConnectionData, {
          userId: args.userId,
          connectionId: args.connectionId,
          ...nextArgs,
        });
      }
    };
    if (!args.referencesCleaned) {
      const next = await cleanupConnectionReferencePage(ctx, {
        userId: args.userId,
        integrationId: connection.integrationId,
        state: args.referenceCleanupPhase
          ? { phase: args.referenceCleanupPhase, cursor: args.referenceCleanupCursor }
          : undefined,
      });
      if (next) {
        await scheduleNext({
          referenceCleanupPhase: next.phase,
          ...(next.cursor ? { referenceCleanupCursor: next.cursor } : {}),
        });
        return null;
      }
    }
    const credentials = await ctx.db
      .query("mcpCredentials")
      .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
      .take(batchSize);
    if (credentials.length > 0) {
      for (const credential of credentials) await ctx.db.delete(credential._id);
      await scheduleNext({ referencesCleaned: true });
      return null;
    }
    const transactions = await ctx.db
      .query("mcpOAuthTransactions")
      .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
      .take(batchSize);
    if (transactions.length > 0) {
      for (const transaction of transactions) await ctx.db.delete(transaction._id);
      await scheduleNext({ referencesCleaned: true });
      return null;
    }
    const hasMoreInvocations = await deleteDisconnectableInvocationPage(
      ctx,
      args.connectionId,
      batchSize,
    );
    if (hasMoreInvocations) {
      await scheduleNext({ referencesCleaned: true });
      return null;
    }
    const items = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
      .take(batchSize);
    if (items.length > 0) {
      for (const item of items) await ctx.db.delete(item._id);
      await scheduleNext({ referencesCleaned: true });
      return null;
    }
    const snapshots = await ctx.db
      .query("mcpCatalogSnapshots")
      .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
      .take(batchSize);
    if (snapshots.length > 0) {
      for (const snapshot of snapshots) await ctx.db.delete(snapshot._id);
      await scheduleNext({ referencesCleaned: true });
      return null;
    }
    await ctx.db.delete(args.connectionId);
    return null;
  },
});
