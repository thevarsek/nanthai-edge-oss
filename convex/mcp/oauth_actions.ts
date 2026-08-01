"use node";

import { createHash, randomBytes } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import {
  decryptSecret,
  encryptSecret,
  mcpCredentialSecretContext,
  mcpOAuthTransactionSecretContext,
} from "../lib/secret_crypto";
import { createDefaultMcpGatewayFetch } from "./gateway_fetch";
import { safeMcpEndpoint } from "./policy";
import { fetchMcpOAuthMetadata } from "./oauth_metadata";

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function configuredValue(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const startOAuth = action({
  args: {
    connectionId: v.string(),
    issuer: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ authorizationUrl: string }> => {
    const { userId } = await requireAuth(ctx);
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnection, {
      userId,
      publicId: args.connectionId,
    });
    if (!connection) throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP server not found." });
    let metadata: Awaited<ReturnType<typeof fetchMcpOAuthMetadata>>;
    try {
      metadata = await fetchMcpOAuthMetadata({ endpoint: connection.endpoint, issuer: args.issuer });
    } catch {
      throw new ConvexError({
        code: "MCP_OAUTH_UNSUPPORTED",
        message: "This server does not publish compatible OAuth metadata with PKCE S256.",
      });
    }
    const clientId = args.clientId?.trim()
      || configuredValue("MCP_OAUTH_CLIENT_ID", "https://nanthai.tech/.well-known/oauth-client.json");
    const redirectUri = configuredValue("MCP_OAUTH_REDIRECT_URI", "https://nanthai.tech/oauth/mcp/callback");
    safeMcpEndpoint(redirectUri);
    const scopes = (args.scopes ?? metadata.scopesSupported)
      .map((scope) => scope.trim())
      .filter(Boolean)
      .slice(0, 50);
    const state = randomBytes(32).toString("base64url");
    const stateHash = sha256(state);
    const verifier = randomBytes(64).toString("base64url");
    const encryptedPkceVerifier = await encryptSecret(
      verifier,
      mcpOAuthTransactionSecretContext({
        userId,
        connectionId: connection._id.toString(),
        issuerOrOrigin: metadata.issuer,
        transactionId: stateHash,
        field: "pkceVerifier",
      }),
    );
    const encryptedClientSecret = args.clientSecret?.trim()
      ? await encryptSecret(
        args.clientSecret.trim(),
        mcpOAuthTransactionSecretContext({
          userId,
          connectionId: connection._id.toString(),
          issuerOrOrigin: metadata.issuer,
          transactionId: stateHash,
          field: "clientSecret",
        }),
      )
      : undefined;
    await ctx.runMutation(internal.mcp.oauth_mutations.createOAuthTransaction, {
      userId,
      connectionId: connection._id,
      stateHash,
      issuerOrOrigin: metadata.issuer,
      resourceOrigin: metadata.resource,
      authorizationEndpoint: metadata.authorizationEndpoint,
      tokenEndpoint: metadata.tokenEndpoint,
      revocationEndpoint: metadata.revocationEndpoint,
      redirectUri,
      scopes,
      clientId,
      clientSecret: encryptedClientSecret,
      encryptedPkceVerifier,
      expiresAt: Date.now() + OAUTH_TRANSACTION_TTL_MS,
    });
    await ctx.runMutation(internal.mcp.mutations.setConnectionStatus, {
      userId,
      connectionId: connection._id,
      status: "authorizing",
    });
    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", sha256(verifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("resource", metadata.resource);
    if (scopes.length > 0) authorizationUrl.searchParams.set("scope", scopes.join(" "));
    return { authorizationUrl: authorizationUrl.toString() };
  },
});

export const completeOAuth = action({
  args: { state: v.string(), code: v.string(), issuer: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ connectionId: string; connected: true }> => {
    const { userId } = await requireAuth(ctx);
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    if (!args.state || args.state.length > 1024 || !args.code || args.code.length > 4096) {
      throw new ConvexError({ code: "MCP_OAUTH_INVALID_CALLBACK", message: "The OAuth callback is invalid." });
    }
    const stateHash = sha256(args.state);
    const transaction = await ctx.runMutation(internal.mcp.oauth_mutations.consumeOAuthTransaction, {
      userId,
      stateHash,
    });
    if (!transaction) {
      throw new ConvexError({ code: "MCP_OAUTH_STATE_EXPIRED", message: "This OAuth attempt expired or was already used." });
    }
    if (args.issuer && args.issuer.replace(/\/$/, "") !== transaction.issuerOrOrigin.replace(/\/$/, "")) {
      throw new ConvexError({ code: "MCP_OAUTH_ISSUER_MISMATCH", message: "The OAuth issuer did not match the server." });
    }
    const transactionContext = {
      userId,
      connectionId: transaction.connectionId.toString(),
      issuerOrOrigin: transaction.issuerOrOrigin,
      transactionId: stateHash,
    } as const;
    const verifier = await decryptSecret(
      transaction.encryptedPkceVerifier,
      mcpOAuthTransactionSecretContext({ ...transactionContext, field: "pkceVerifier" }),
    );
    const clientSecret = transaction.clientSecret
      ? await decryptSecret(
        transaction.clientSecret,
        mcpOAuthTransactionSecretContext({ ...transactionContext, field: "clientSecret" }),
      )
      : undefined;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: transaction.redirectUri,
      client_id: transaction.clientId,
      code_verifier: verifier,
      resource: transaction.resourceOrigin,
    });
    if (clientSecret) body.set("client_secret", clientSecret);
    const response = await createDefaultMcpGatewayFetch()(new URL(transaction.tokenEndpoint), {
      method: "POST",
      redirect: "manual",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new ConvexError({ code: "MCP_OAUTH_EXCHANGE_FAILED", message: "The OAuth server rejected the authorization code." });
    }
    const tokens = await response.json() as Record<string, unknown>;
    if (typeof tokens.access_token !== "string" || tokens.token_type?.toString().toLowerCase() !== "bearer") {
      throw new ConvexError({ code: "MCP_OAUTH_EXCHANGE_FAILED", message: "The OAuth server returned an invalid token response." });
    }
    const credentialContext = {
      userId,
      connectionId: transaction.connectionId.toString(),
      issuerOrOrigin: transaction.issuerOrOrigin,
    } as const;
    const accessToken = await encryptSecret(
      tokens.access_token,
      mcpCredentialSecretContext({ ...credentialContext, field: "accessToken" }),
    );
    const refreshToken = typeof tokens.refresh_token === "string"
      ? await encryptSecret(
        tokens.refresh_token,
        mcpCredentialSecretContext({ ...credentialContext, field: "refreshToken" }),
      )
      : undefined;
    const storedClientSecret = clientSecret
      ? await encryptSecret(
        clientSecret,
        mcpCredentialSecretContext({ ...credentialContext, field: "clientSecret" }),
      )
      : undefined;
    const scope = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : transaction.scopes;
    const stored = await ctx.runMutation(internal.mcp.mutations.storeCredential, {
      userId,
      connectionId: transaction.connectionId,
      authMode: "oauth",
      issuerOrOrigin: transaction.issuerOrOrigin,
      resourceOrigin: transaction.resourceOrigin,
      accessToken,
      refreshToken,
      clientId: transaction.clientId,
      clientSecret: storedClientSecret,
      tokenEndpoint: transaction.tokenEndpoint,
      revocationEndpoint: transaction.revocationEndpoint,
      scopes: scope,
      expiresAt: typeof tokens.expires_in === "number"
        ? Date.now() + Math.max(0, Math.min(tokens.expires_in, 31_536_000)) * 1000
        : undefined,
      expectedOAuthStateHash: stateHash,
    });
    if (!stored) {
      throw new ConvexError({
        code: "MCP_OAUTH_STATE_EXPIRED",
        message: "A newer OAuth attempt replaced this one.",
      });
    }
    await ctx.runMutation(internal.mcp.mutations.setConnectionStatus, {
      userId,
      connectionId: transaction.connectionId,
      status: "validating",
    });
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnectionById, {
      userId,
      connectionId: transaction.connectionId,
    });
    if (!connection) throw new ConvexError({ code: "NOT_FOUND", message: "Remote MCP server not found." });
    await ctx.runMutation(internal.mcp.oauth_mutations.deleteOAuthTransaction, {
      userId,
      transactionId: transaction._id,
    });
    return { connectionId: connection.publicId, connected: true };
  },
});
