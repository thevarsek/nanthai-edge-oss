import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { requirePro } from "../lib/auth";
import { mcpCatalogItemDisplayName } from "./display";
import {
  getConnectionHandler,
  getInvocationHandler,
  listActiveConnectionOptionsHandler,
  listAvailableContentHandler,
  listConnectionsHandler,
  listPendingForChatHandler,
} from "./query_public_handlers";

export const assertPro = internalQuery({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePro(ctx, args.userId);
    return null;
  },
});

export const assertOwnedChat = internalQuery({
  args: { userId: v.string(), chatId: v.id("chats") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== args.userId) throw new Error("MCP_CHAT_NOT_FOUND");
    return null;
  },
});

export const getOwnedConnection = internalQuery({
  args: { userId: v.string(), publicId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("mcpConnections")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", args.userId).eq("publicId", args.publicId),
      )
      .unique();
    return connection;
  },
});

export const getOwnedConnectionById = internalQuery({
  args: { userId: v.string(), connectionId: v.id("mcpConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    return connection?.userId === args.userId ? connection : null;
  },
});

export const getCredential = internalQuery({
  args: { userId: v.string(), connectionId: v.id("mcpConnections") },
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("mcpCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .unique();
    return credential?.userId === args.userId ? credential : null;
  },
});

export const getAllowedItem = internalQuery({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    stableKey: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_stable_key", (q) =>
        q.eq("connectionId", args.connectionId).eq("stableKey", args.stableKey),
      )
      .unique();
    return item?.userId === args.userId && item.decision === "allowed" ? item : null;
  },
});

export const getCatalogItemStableKey = internalQuery({
  args: { itemId: v.id("mcpCatalogItems") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => (await ctx.db.get(args.itemId))?.stableKey ?? null,
});

export const getCatalogItemByIdInternal = internalQuery({
  args: { itemId: v.id("mcpCatalogItems") },
  handler: async (ctx, args) => await ctx.db.get(args.itemId),
});

export const listAllowedToolsForIntegrations = internalQuery({
  args: { userId: v.string(), integrationIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.integrationIds.length === 0) return [];
    const requested = new Set(args.integrationIds);
    const connections = await ctx.db
      .query("mcpConnections")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "active"))
      .collect();
    const selected = connections.filter((connection) => requested.has(connection.integrationId));
    const tools = await Promise.all(selected.map(async (connection) => {
      const items = await ctx.db
        .query("mcpCatalogItems")
        .withIndex("by_connection_decision", (q) =>
          q.eq("connectionId", connection._id).eq("decision", "allowed").eq("kind", "tool"),
        )
        .collect();
      return items.map((item) => ({
        connectionId: connection.publicId,
        integrationId: connection.integrationId,
        integrationName: connection.friendlyName?.trim() || connection.endpointHost,
        stableKey: item.stableKey,
        remoteName: item.remoteName,
        displayName: mcpCatalogItemDisplayName(item),
        alias: item.toolAlias,
        description: item.description,
        inputSchema: item.inputSchema,
      }));
    }));
    return tools.flat().slice(0, 96);
  },
});

export const listAvailableContent = query({
  args: {},
  handler: listAvailableContentHandler,
});

export const getInvocationContextsInternal = internalQuery({
  args: { userId: v.string(), invocationIds: v.array(v.id("mcpInvocations")) },
  handler: async (ctx, args) => {
    const rows = [];
    for (const invocationId of args.invocationIds.slice(0, 32)) {
      const invocation = await ctx.db.get(invocationId);
      if (
        !invocation
        || invocation.userId !== args.userId
        || invocation.state !== "completed"
        || !invocation.contextText
      ) continue;
      rows.push({
        invocationId: invocation._id,
        publicId: invocation.publicId,
        kind: invocation.kind,
        contextText: invocation.contextText,
        contentItems: invocation.contentItems,
      });
    }
    return rows;
  },
});

export const listConnections = query({
  args: {},
  handler: listConnectionsHandler,
});

export const listActiveConnectionOptions = query({
  args: {},
  handler: listActiveConnectionOptionsHandler,
});

export const getConnection = query({
  args: { connectionId: v.string() },
  handler: async (ctx, args) => await getConnectionHandler(ctx, args.connectionId),
});

export const getInvocation = query({
  args: { invocationId: v.string() },
  handler: async (ctx, args) => await getInvocationHandler(ctx, args.invocationId),
});

export const listPendingForChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => await listPendingForChatHandler(ctx, args.chatId),
});

export const getOwnedInvocationInternal = internalQuery({
  args: { userId: v.string(), publicId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mcpInvocations")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", args.userId).eq("publicId", args.publicId),
      )
      .unique();
  },
});

export const getInvocationByIdInternal = internalQuery({
  args: { invocationId: v.id("mcpInvocations") },
  handler: async (ctx, args) => await ctx.db.get(args.invocationId),
});
