"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { decryptSecret, mcpCredentialSecretContext } from "../lib/secret_crypto";
import { createDefaultMcpGatewayFetch } from "./gateway_fetch";

type RevocationRequest = { endpoint: string; body: URLSearchParams };

export const disconnect = action({
  args: { connectionId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireAuth(ctx);
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnection, {
      userId,
      publicId: args.connectionId,
    });
    if (!connection) return null;
    const credential = await ctx.runQuery(internal.mcp.queries.getCredential, {
      userId,
      connectionId: connection._id,
    });
    let revocation: RevocationRequest | undefined;
    if (credential?.authMode === "oauth" && credential.revocationEndpoint) {
      try {
        const encryptedToken = credential.refreshToken ?? credential.accessToken;
        const field = credential.refreshToken ? "refreshToken" : "accessToken";
        if (encryptedToken) {
          const context = {
            userId,
            connectionId: connection._id.toString(),
            issuerOrOrigin: credential.issuerOrOrigin,
          } as const;
          const token = await decryptSecret(
            encryptedToken,
            mcpCredentialSecretContext({ ...context, field }),
          );
          const clientSecret = credential.clientSecret
            ? await decryptSecret(
              credential.clientSecret,
              mcpCredentialSecretContext({ ...context, field: "clientSecret" }),
            )
            : undefined;
          const body = new URLSearchParams({ token });
          if (credential.clientId) body.set("client_id", credential.clientId);
          if (clientSecret) body.set("client_secret", clientSecret);
          revocation = { endpoint: credential.revocationEndpoint, body };
        }
      } catch {
        // Local deletion remains authoritative if best-effort revocation cannot be prepared.
      }
    }
    await ctx.runMutation(internal.mcp.mutations.beginConnectionDisconnect, {
      userId,
      connectionId: connection._id,
    });
    await ctx.runMutation(internal.mcp.lifecycle_mutations.cancelConnectionInvocations, {
      userId,
      connectionId: connection._id,
      reason: "Remote MCP server was disconnected.",
      deleteConnectionAfter: true,
    });
    if (revocation) {
      try {
        await createDefaultMcpGatewayFetch()(new URL(revocation.endpoint), {
          method: "POST",
          redirect: "manual",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: revocation.body,
        });
      } catch {
        // Revocation is best effort after the local credential and connection are gone.
      }
    }
    return null;
  },
});
