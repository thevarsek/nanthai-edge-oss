"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { encryptSecret, mcpCredentialSecretContext } from "../lib/secret_crypto";
import { persistDiscovery } from "./catalog";
import { safeApiKeyHeader } from "./policy";

export const replaceHeaderCredential = action({
  args: {
    connectionId: v.string(),
    secret: v.string(),
    apiKeyHeader: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ itemCount: number }> => {
    const { userId } = await requireAuth(ctx);
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnection, {
      userId,
      publicId: args.connectionId,
    });
    if (!connection || (connection.authMode !== "bearer" && connection.authMode !== "api_key")) {
      throw new ConvexError({ code: "MCP_AUTH_UNSUPPORTED", message: "This credential cannot be updated here." });
    }
    const value = args.secret.trim();
    if (!value) throw new ConvexError({ code: "MCP_CREDENTIAL_REQUIRED", message: "Enter the server credential." });
    const apiKeyHeader = connection.authMode === "api_key"
      ? safeApiKeyHeader(args.apiKeyHeader ?? "")
      : undefined;
    const encrypted = await encryptSecret(value, mcpCredentialSecretContext({
      userId,
      connectionId: connection._id.toString(),
      issuerOrOrigin: connection.endpointOrigin,
      field: "credentialValue",
    }));
    await ctx.runMutation(internal.mcp.mutations.storeCredential, {
      userId,
      connectionId: connection._id,
      authMode: connection.authMode,
      issuerOrOrigin: connection.endpointOrigin,
      resourceOrigin: connection.endpointOrigin,
      apiKeyHeader,
      credentialValue: encrypted,
    });
    try {
      const itemCount = await persistDiscovery(ctx, {
        userId,
        connection,
        credential: connection.authMode === "bearer"
          ? { bearerToken: value }
          : { apiKeyHeader, apiKeyValue: value },
      });
      return { itemCount };
    } catch {
      await ctx.runMutation(internal.mcp.mutations.markConnectionFailure, {
        connectionId: connection._id,
        status: "auth_required",
        errorCode: "MCP_AUTH_REQUIRED",
      });
      throw new ConvexError({ code: "MCP_AUTH_REQUIRED", message: "The Remote MCP server rejected this credential." });
    }
  },
});
