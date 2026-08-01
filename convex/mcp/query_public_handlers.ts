import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireAuth, requirePro } from "../lib/auth";
import { isUserPro } from "../preferences/entitlements";
import {
  mcpActiveConnectionOption,
  mcpCatalogCounts,
  mcpCatalogItemDisplayName,
  mcpConnectionDisplayName,
} from "./display";
import { mcpJsonFromStorage } from "./json_codec";

export async function listAvailableContentHandler(ctx: QueryCtx) {
  const { userId } = await requireAuth(ctx);
  if (!await isUserPro(ctx, userId)) return [];
  const connections = await ctx.db
    .query("mcpConnections")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
    .collect();
  const groups = await Promise.all(connections.map(async (connection) => {
    const items = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_connection_decision", (q) =>
        q.eq("connectionId", connection._id).eq("decision", "allowed"),
      )
      .collect();
    return items.filter((item) => item.kind !== "tool").map((item) => ({
      connectionId: connection.publicId,
      integrationId: connection.integrationId,
      serverName: mcpConnectionDisplayName(connection),
      stableKey: item.stableKey,
      kind: item.kind,
      name: item.remoteName,
      displayName: mcpCatalogItemDisplayName(item),
      description: item.description,
      uri: item.uri,
      uriTemplate: item.uriTemplate,
      mimeType: item.mimeType,
      arguments: item.arguments,
    }));
  }));
  return groups.flat().slice(0, 96);
}

export async function listConnectionsHandler(ctx: QueryCtx) {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const connections = await ctx.db
    .query("mcpConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();
  return await Promise.all(connections.map(async (connection) => {
    const items = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
      .collect();
    const counts = mcpCatalogCounts(items);
    return {
      id: connection.publicId,
      integrationId: connection.integrationId,
      displayName: mcpConnectionDisplayName(connection),
      endpoint: connection.endpoint,
      endpointHost: connection.endpointHost,
      friendlyName: connection.friendlyName,
      status: connection.status,
      authMode: connection.authMode,
      protocolVersion: connection.protocolVersion,
      serverName: connection.serverName,
      serverVersion: connection.serverVersion,
      lastCheckedAt: connection.lastCheckedAt,
      lastErrorCode: connection.lastErrorCode,
      ...counts,
      updatedAt: connection.updatedAt,
    };
  }));
}

export async function listActiveConnectionOptionsHandler(ctx: QueryCtx) {
  const { userId } = await requireAuth(ctx);
  if (!await isUserPro(ctx, userId)) return [];
  const connections = await ctx.db
    .query("mcpConnections")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
    .collect();
  return await Promise.all(connections.map(async (connection) => {
    const allowed = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_connection_decision", (q) =>
        q.eq("connectionId", connection._id).eq("decision", "allowed"),
      )
      .collect();
    return mcpActiveConnectionOption(connection, allowed.length);
  }));
}

export async function getConnectionHandler(ctx: QueryCtx, connectionId: string) {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const connection = await ctx.db
    .query("mcpConnections")
    .withIndex("by_user_public_id", (q) => q.eq("userId", userId).eq("publicId", connectionId))
    .unique();
  if (!connection) return null;
  const items = await ctx.db
    .query("mcpCatalogItems")
    .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
    .collect();
  const counts = mcpCatalogCounts(items);
  return {
    id: connection.publicId,
    integrationId: connection.integrationId,
    displayName: mcpConnectionDisplayName(connection),
    endpoint: connection.endpoint,
    endpointHost: connection.endpointHost,
    friendlyName: connection.friendlyName,
    status: connection.status,
    authMode: connection.authMode,
    protocolVersion: connection.protocolVersion,
    serverName: connection.serverName,
    serverVersion: connection.serverVersion,
    instructions: connection.instructions,
    lastCheckedAt: connection.lastCheckedAt,
    lastErrorCode: connection.lastErrorCode,
    ...counts,
    updatedAt: connection.updatedAt,
    items: items.map((item) => ({
      stableKey: item.stableKey,
      kind: item.kind,
      name: item.remoteName,
      displayName: mcpCatalogItemDisplayName(item),
      title: item.title,
      description: item.description,
      uri: item.uri,
      uriTemplate: item.uriTemplate,
      mimeType: item.mimeType,
      inputSchema: item.inputSchema,
      arguments: item.arguments,
      decision: item.decision,
      disabledReason: item.disabledReason,
    })),
  };
}

export async function getInvocationHandler(ctx: QueryCtx, invocationId: string) {
  const { userId } = await requireAuth(ctx);
  const invocation = await ctx.db
    .query("mcpInvocations")
    .withIndex("by_user_public_id", (q) => q.eq("userId", userId).eq("publicId", invocationId))
    .unique();
  if (!invocation) return null;
  return {
    id: invocation.publicId,
    state: invocation.state,
    kind: invocation.kind,
    inputRequests: mcpJsonFromStorage(invocation.inputRequests),
    taskStatus: invocation.taskStatus,
    result: mcpJsonFromStorage(invocation.result),
    contextText: invocation.contextText,
    contentItems: invocation.contentItems,
    errorCode: invocation.errorCode,
    updatedAt: invocation.updatedAt,
  };
}

export async function listPendingForChatHandler(ctx: QueryCtx, chatId: Id<"chats">) {
  const { userId } = await requireAuth(ctx);
  const chat = await ctx.db.get(chatId);
  if (!chat || chat.userId !== userId) return [];
  const pending = (await Promise.all(["awaiting_input", "task_pending"].map(async (state) =>
    await ctx.db
      .query("mcpInvocations")
      .withIndex("by_chat_state", (query) => query
        .eq("chatId", chatId)
        .eq("state", state as "awaiting_input" | "task_pending"))
      .order("desc")
      .take(8))))
    .flat()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 8);
  const rows = [];
  for (const invocation of pending) {
    if (invocation.userId !== userId) continue;
    const [connection, item] = await Promise.all([
      ctx.db.get(invocation.connectionId),
      invocation.catalogItemId ? ctx.db.get(invocation.catalogItemId) : Promise.resolve(null),
    ]);
    const itemName = invocation.itemName ?? (item ? mcpCatalogItemDisplayName(item) : undefined);
    if (!connection || !itemName) continue;
    rows.push({
      invocationId: invocation.publicId,
      state: invocation.state,
      kind: invocation.kind,
      serverName: mcpConnectionDisplayName(connection),
      itemName,
      inputRequests: mcpJsonFromStorage(invocation.inputRequests),
      requestState: mcpJsonFromStorage(invocation.requestState),
      taskStatus: invocation.taskStatus,
      result: mcpJsonFromStorage(invocation.result),
      updatedAt: invocation.updatedAt,
    });
  }
  return rows.slice(0, 8);
}
