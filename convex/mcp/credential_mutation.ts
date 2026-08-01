import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertEncryptedSecret, parseSecretEnvelope } from "../lib/secret_crypto";
import { isUserDataWritable } from "../lib/write_fence";

export const mcpCredentialAuthMode = v.union(
  v.literal("none"),
  v.literal("bearer"),
  v.literal("api_key"),
  v.literal("oauth"),
);

type StoreCredentialArgs = {
  userId: string;
  connectionId: Id<"mcpConnections">;
  authMode: "none" | "bearer" | "api_key" | "oauth";
  issuerOrOrigin: string;
  resourceOrigin: string;
  apiKeyHeader?: string;
  accessToken?: string;
  refreshToken?: string;
  credentialValue?: string;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  revocationEndpoint?: string;
  scopes?: string[];
  expiresAt?: number;
  expectedOAuthStateHash?: string;
};

export async function storeMcpCredential(
  ctx: MutationCtx,
  args: StoreCredentialArgs,
): Promise<boolean> {
  const { expectedOAuthStateHash, ...credentialArgs } = args;
  if (!await isUserDataWritable(ctx, args.userId)) return false;
  const connection = await ctx.db.get(args.connectionId);
  if (
    !connection
    || connection.userId !== args.userId
    || (expectedOAuthStateHash !== undefined
      && connection.oauthTransactionStateHash !== expectedOAuthStateHash)
  ) return false;
  const envelopes = [
    args.accessToken,
    args.refreshToken,
    args.credentialValue,
    args.clientSecret,
  ].filter((value): value is string => Boolean(value));
  for (const envelope of envelopes) assertEncryptedSecret(envelope);
  const metadata = envelopes.length > 0 ? parseSecretEnvelope(envelopes[0] ?? "") : null;
  if (!metadata) throw new Error("Encrypted MCP credential metadata is missing.");
  const now = Date.now();
  const existing = await ctx.db
    .query("mcpCredentials")
    .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
    .unique();
  const values = {
    ...credentialArgs,
    refreshRevision: (existing?.refreshRevision ?? 0) + 1,
    secretEnvelopeVersion: metadata.envelopeVersion,
    secretKeyId: metadata.keyId,
    secretMigratedAt: now,
    updatedAt: now,
  } as const;
  if (existing) {
    await ctx.db.replace(existing._id, { ...values, createdAt: existing.createdAt });
  } else {
    await ctx.db.insert("mcpCredentials", { ...values, createdAt: now });
  }
  if (expectedOAuthStateHash !== undefined) {
    await ctx.db.patch(connection._id, {
      oauthTransactionStateHash: undefined,
      updatedAt: now,
    });
  }
  return true;
}
