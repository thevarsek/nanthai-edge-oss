"use node";

import { randomUUID } from "node:crypto";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  decryptSecret,
  encryptSecret,
  mcpCredentialSecretContext,
} from "../lib/secret_crypto";
import { createDefaultMcpGatewayFetch } from "./gateway_fetch";
import type { McpConnectionCredential } from "./sdk_client";

const REFRESH_SKEW_MS = 60_000;
const REFRESH_LEASE_MS = 120_000;

function secretContext(
  userId: string,
  connectionId: Id<"mcpConnections">,
  issuerOrOrigin: string,
  field: "accessToken" | "refreshToken" | "credentialValue" | "clientSecret",
) {
  return mcpCredentialSecretContext({
    userId,
    connectionId: connectionId.toString(),
    issuerOrOrigin,
    field,
  });
}

async function decryptAccessToken(
  userId: string,
  connectionId: Id<"mcpConnections">,
  row: Doc<"mcpCredentials">,
): Promise<string> {
  if (!row.accessToken) throw new Error("MCP OAuth access token is unavailable.");
  return await decryptSecret(
    row.accessToken,
    secretContext(userId, connectionId, row.issuerOrOrigin, "accessToken"),
  );
}

async function refreshOAuthCredential(
  ctx: ActionCtx,
  userId: string,
  connectionId: Id<"mcpConnections">,
  row: Doc<"mcpCredentials">,
): Promise<string> {
  if (!row.refreshToken || !row.tokenEndpoint || !row.clientId) {
    throw new Error("MCP OAuth reconnect is required.");
  }
  const leaseId = randomUUID();
  const claimed = await ctx.runMutation(internal.mcp.oauth_mutations.claimOAuthRefresh, {
    userId,
    connectionId,
    expectedRevision: row.refreshRevision,
    leaseId,
    leaseExpiresAt: Date.now() + REFRESH_LEASE_MS,
  });
  if (!claimed) {
    const winner = await ctx.runQuery(internal.mcp.queries.getCredential, { userId, connectionId });
    if (!winner) throw new Error("MCP OAuth credential was removed.");
    if (winner.refreshRevision !== row.refreshRevision || (winner.expiresAt ?? 0) > Date.now()) {
      return await decryptAccessToken(userId, connectionId, winner);
    }
    throw new Error("MCP OAuth refresh is already in progress.");
  }
  try {
    const refreshToken = await decryptSecret(
      row.refreshToken,
      secretContext(userId, connectionId, row.issuerOrOrigin, "refreshToken"),
    );
    const clientSecret = row.clientSecret
      ? await decryptSecret(
        row.clientSecret,
        secretContext(userId, connectionId, row.issuerOrOrigin, "clientSecret"),
      )
      : undefined;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: row.clientId,
      resource: row.resourceOrigin,
    });
    if (clientSecret) body.set("client_secret", clientSecret);
    const response = await createDefaultMcpGatewayFetch()(new URL(row.tokenEndpoint), {
      method: "POST",
      redirect: "manual",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error("MCP OAuth refresh failed.");
    const tokens = await response.json() as Record<string, unknown>;
    if (typeof tokens.access_token !== "string" || tokens.token_type?.toString().toLowerCase() !== "bearer") {
      throw new Error("MCP OAuth refresh response was invalid.");
    }
    const accessToken = await encryptSecret(
      tokens.access_token,
      secretContext(userId, connectionId, row.issuerOrOrigin, "accessToken"),
    );
    const nextRefreshToken = typeof tokens.refresh_token === "string"
      ? await encryptSecret(
        tokens.refresh_token,
        secretContext(userId, connectionId, row.issuerOrOrigin, "refreshToken"),
      )
      : undefined;
    const scopes = typeof tokens.scope === "string"
      ? tokens.scope.split(/\s+/).filter(Boolean).slice(0, 50)
      : undefined;
    const expiresAt = typeof tokens.expires_in === "number"
      ? Date.now() + Math.max(0, Math.min(tokens.expires_in, 31_536_000)) * 1000
      : undefined;
    const applied = await ctx.runMutation(internal.mcp.oauth_mutations.applyOAuthRefresh, {
      userId,
      connectionId,
      expectedRevision: row.refreshRevision,
      accessToken,
      refreshToken: nextRefreshToken,
      scopes,
      expiresAt,
      leaseId,
    });
    if (applied) return tokens.access_token;
    const winner = await ctx.runQuery(internal.mcp.queries.getCredential, { userId, connectionId });
    if (!winner) throw new Error("MCP OAuth credential was removed.");
    if (
      winner.refreshRevision !== row.refreshRevision
      && (winner.expiresAt ?? 0) > Date.now() + REFRESH_SKEW_MS
    ) {
      return await decryptAccessToken(userId, connectionId, winner);
    }
    throw new Error("MCP OAuth refresh was superseded before a valid token was stored.");
  } catch (error) {
    await ctx.runMutation(internal.mcp.oauth_mutations.releaseOAuthRefresh, {
      userId,
      connectionId,
      leaseId,
    }).catch(() => undefined);
    throw error;
  }
}

export async function loadMcpCredential(
  ctx: ActionCtx,
  userId: string,
  connectionId: Id<"mcpConnections">,
): Promise<McpConnectionCredential | undefined> {
  const row = await ctx.runQuery(internal.mcp.queries.getCredential, { userId, connectionId });
  if (!row) return undefined;
  if (row.authMode === "oauth") {
    const token = row.expiresAt !== undefined && row.expiresAt <= Date.now() + REFRESH_SKEW_MS
      ? await refreshOAuthCredential(ctx, userId, connectionId, row)
      : await decryptAccessToken(userId, connectionId, row);
    return { bearerToken: token };
  }
  if (!row.credentialValue) return undefined;
  const value = await decryptSecret(
    row.credentialValue,
    secretContext(userId, connectionId, row.issuerOrOrigin, "credentialValue"),
  );
  if (row.authMode === "api_key") {
    return { apiKeyHeader: row.apiKeyHeader, apiKeyValue: value };
  }
  return { bearerToken: value };
}
