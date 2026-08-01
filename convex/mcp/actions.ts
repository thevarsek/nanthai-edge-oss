"use node";

import { randomUUID } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { mcpDiscoveryErrorCode, persistDiscovery } from "./catalog";
import { loadMcpCredential } from "./credentials";
import type { McpConnectionCredential } from "./sdk_client";
import {
  encryptedConnectionCredential,
  mcpAuthMode,
  mcpInvocationKind,
} from "./action_contract";
import {
  boundedText,
  isMcpAuthenticationError,
  safeApiKeyHeader,
  safeMcpEndpoint,
  unsupportedServerMessage,
} from "./policy";
import { invokeMcp } from "./invoke_action";

export const addServer = action({
  args: {
    endpoint: v.string(),
    friendlyName: v.optional(v.string()),
    authMode: mcpAuthMode,
    secret: v.optional(v.string()),
    apiKeyHeader: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ connectionId: string; status: string; itemCount: number }> => {
    const { userId } = await requireAuth(ctx);
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    const endpoint = safeMcpEndpoint(args.endpoint);
    const friendlyName = boundedText(args.friendlyName, 100);
    const publicId = randomUUID();
    const normalizedSecret = args.secret?.trim();
    const header = args.authMode === "api_key" && args.apiKeyHeader
      ? safeApiKeyHeader(args.apiKeyHeader)
      : undefined;
    if ((args.authMode === "bearer" || args.authMode === "api_key") && !normalizedSecret) {
      throw new ConvexError({ code: "MCP_CREDENTIAL_REQUIRED", message: "Enter the server credential." });
    }
    if (args.authMode === "api_key" && !header) {
      throw new ConvexError({ code: "MCP_HEADER_REQUIRED", message: "Enter the API key header name." });
    }
    const connectionId = await ctx.runMutation(internal.mcp.mutations.createConnection, {
      userId,
      publicId,
      endpoint: endpoint.endpoint,
      endpointOrigin: endpoint.origin,
      endpointHost: endpoint.host,
      friendlyName,
      authMode: args.authMode,
    });
    let credential: McpConnectionCredential | undefined;
    if (normalizedSecret && (args.authMode === "bearer" || args.authMode === "api_key")) {
      const encrypted = await encryptedConnectionCredential({
        userId,
        connectionId: connectionId.toString(),
        issuerOrOrigin: endpoint.origin,
        secret: normalizedSecret,
      });
      await ctx.runMutation(internal.mcp.mutations.storeCredential, {
        userId,
        connectionId,
        authMode: args.authMode,
        issuerOrOrigin: endpoint.origin,
        resourceOrigin: endpoint.origin,
        apiKeyHeader: header,
        credentialValue: encrypted,
      });
      credential = args.authMode === "bearer"
        ? { bearerToken: normalizedSecret }
        : { apiKeyHeader: header, apiKeyValue: normalizedSecret };
    }
    try {
      const itemCount = await persistDiscovery(ctx, {
        userId,
        connection: { _id: connectionId, publicId, endpoint: endpoint.endpoint },
        credential,
      });
      return { connectionId: publicId, status: "reviewing", itemCount };
    } catch (error) {
      const requiresAuth = isMcpAuthenticationError(error);
      await ctx.runMutation(internal.mcp.mutations.markConnectionFailure, {
        connectionId,
        status: requiresAuth ? "auth_required" : "unsupported",
        errorCode: requiresAuth ? "MCP_AUTH_REQUIRED" : "MCP_UNSUPPORTED_SERVER",
      });
      if (requiresAuth) {
        return { connectionId: publicId, status: "auth_required", itemCount: 0 };
      }
      throw new ConvexError({ code: "MCP_UNSUPPORTED_SERVER", message: unsupportedServerMessage() });
    }
  },
});

export const refreshCatalog = action({
  args: { connectionId: v.string() },
  handler: async (ctx, args): Promise<{ itemCount: number }> => {
    const { userId } = await requireAuth(ctx);
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnection, {
      userId,
      publicId: args.connectionId,
    });
    if (!connection) throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP server not found." });
    try {
      const credential = await loadMcpCredential(ctx, userId, connection._id);
      return { itemCount: await persistDiscovery(ctx, { userId, connection, credential }) };
    } catch (error) {
      const requiresAuth = isMcpAuthenticationError(error);
      const errorCode = requiresAuth
        ? "MCP_AUTH_REQUIRED"
        : mcpDiscoveryErrorCode(error) ?? "MCP_REFRESH_FAILED";
      await ctx.runMutation(internal.mcp.mutations.markConnectionFailure, {
        connectionId: connection._id,
        status: requiresAuth ? "auth_required" : "error",
        errorCode,
      });
      throw new ConvexError({
        code: requiresAuth ? "MCP_AUTH_REQUIRED" : "MCP_REFRESH_FAILED",
        message: requiresAuth ? "Reconnect this Remote MCP server." : "The Remote MCP catalog could not be refreshed.",
      });
    }
  },
});

export const invoke = action({
  args: {
    connectionId: v.string(),
    stableKey: v.string(),
    kind: mcpInvocationKind,
    arguments: v.optional(v.any()),
    uri: v.optional(v.string()),
    requestState: v.optional(v.any()),
    inputResponses: v.optional(v.any()),
    chatId: v.optional(v.id("chats")),
  },
  handler: invokeMcp,
});
