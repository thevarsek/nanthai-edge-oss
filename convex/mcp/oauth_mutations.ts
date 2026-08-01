import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { assertEncryptedSecret, parseSecretEnvelope } from "../lib/secret_crypto";
import { assertUserDataWritable } from "../lib/write_fence";

export const createOAuthTransaction = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    stateHash: v.string(),
    issuerOrOrigin: v.string(),
    resourceOrigin: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    revocationEndpoint: v.optional(v.string()),
    redirectUri: v.string(),
    scopes: v.array(v.string()),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    encryptedPkceVerifier: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await assertUserDataWritable(ctx, args.userId);
    assertEncryptedSecret(args.encryptedPkceVerifier);
    if (args.clientSecret) assertEncryptedSecret(args.clientSecret);
    const metadata = parseSecretEnvelope(args.encryptedPkceVerifier);
    if (!metadata) throw new Error("Encrypted OAuth transaction metadata is missing.");
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.userId !== args.userId) {
      throw new Error("MCP OAuth connection is unavailable.");
    }
    const priorTransactions = await ctx.db
      .query("mcpOAuthTransactions")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .collect();
    for (const transaction of priorTransactions) await ctx.db.delete(transaction._id);
    const duplicate = await ctx.db
      .query("mcpOAuthTransactions")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (duplicate) throw new Error("Duplicate MCP OAuth state.");
    const transactionId = await ctx.db.insert("mcpOAuthTransactions", {
      ...args,
      secretEnvelopeVersion: metadata.envelopeVersion,
      secretKeyId: metadata.keyId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.connectionId, {
      oauthTransactionStateHash: args.stateHash,
      updatedAt: Date.now(),
    });
    return transactionId;
  },
});

export const consumeOAuthTransaction = internalMutation({
  args: { userId: v.string(), stateHash: v.string() },
  handler: async (ctx, args) => {
    const transaction = await ctx.db
      .query("mcpOAuthTransactions")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (
      !transaction
      || transaction.userId !== args.userId
      || transaction.consumedAt !== undefined
      || transaction.expiresAt <= Date.now()
    ) {
      return null;
    }
    await ctx.db.patch(transaction._id, { consumedAt: Date.now() });
    return transaction;
  },
});

export const applyOAuthRefresh = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    expectedRevision: v.number(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    expiresAt: v.optional(v.number()),
    leaseId: v.string(),
  },
  handler: async (ctx, args) => {
    assertEncryptedSecret(args.accessToken);
    if (args.refreshToken) assertEncryptedSecret(args.refreshToken);
    const credential = await ctx.db
      .query("mcpCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .unique();
    if (
      !credential
      || credential.userId !== args.userId
      || credential.authMode !== "oauth"
      || credential.refreshRevision !== args.expectedRevision
      || credential.refreshLeaseId !== args.leaseId
    ) {
      return false;
    }
    const metadata = parseSecretEnvelope(args.accessToken);
    if (!metadata) throw new Error("Encrypted OAuth refresh metadata is missing.");
    await ctx.db.patch(credential._id, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken ?? credential.refreshToken,
      scopes: args.scopes ?? credential.scopes,
      expiresAt: args.expiresAt,
      refreshRevision: credential.refreshRevision + 1,
      refreshLeaseId: undefined,
      refreshLeaseExpiresAt: undefined,
      secretEnvelopeVersion: metadata.envelopeVersion,
      secretKeyId: metadata.keyId,
      secretMigratedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const claimOAuthRefresh = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    expectedRevision: v.number(),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("mcpCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .unique();
    if (
      !credential
      || credential.userId !== args.userId
      || credential.authMode !== "oauth"
      || credential.refreshRevision !== args.expectedRevision
      || (credential.refreshLeaseExpiresAt !== undefined
        && credential.refreshLeaseExpiresAt > Date.now())
    ) return false;
    await ctx.db.patch(credential._id, {
      refreshLeaseId: args.leaseId,
      refreshLeaseExpiresAt: args.leaseExpiresAt,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const releaseOAuthRefresh = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    leaseId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("mcpCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .unique();
    if (credential?.userId === args.userId && credential.refreshLeaseId === args.leaseId) {
      await ctx.db.patch(credential._id, {
        refreshLeaseId: undefined,
        refreshLeaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const deleteOAuthTransaction = internalMutation({
  args: { userId: v.string(), transactionId: v.id("mcpOAuthTransactions") },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (transaction?.userId === args.userId) await ctx.db.delete(transaction._id);
    return null;
  },
});

export const cleanupExpiredOAuthTransactions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const batchSize = 100;
    const expired = await ctx.db
      .query("mcpOAuthTransactions")
      .withIndex("by_expiry", (query) => query.lt("expiresAt", Date.now()))
      .take(batchSize);
    for (const transaction of expired) await ctx.db.delete(transaction._id);
    if (expired.length === batchSize) {
      await ctx.scheduler.runAfter(
        0,
        internal.mcp.oauth_mutations.cleanupExpiredOAuthTransactions,
        {},
      );
    }
    return expired.length;
  },
});
