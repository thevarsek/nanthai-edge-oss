import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getRotationState = internalQuery({
  args: { rotationId: v.id("secretCryptoRotations") },
  handler: async (ctx, args) => await ctx.db.get(args.rotationId),
});

export const listOAuthCredentialPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      id: v.id("oauthConnections"),
      userId: v.string(),
      provider: v.string(),
      accessToken: v.string(),
      refreshToken: v.string(),
      lastRefreshedAt: v.optional(v.number()),
      secretKeyId: v.optional(v.string()),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("oauthConnections").paginate(args.paginationOpts);
    return {
      page: result.page.map((row) => ({
        id: row._id,
        userId: row.userId,
        provider: row.provider,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        lastRefreshedAt: row.lastRefreshedAt,
        secretKeyId: row.secretKeyId,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listUserSecretPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      id: v.id("userSecrets"),
      userId: v.string(),
      apiKey: v.string(),
      updatedAt: v.number(),
      secretKeyId: v.optional(v.string()),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("userSecrets").paginate(args.paginationOpts);
    return {
      page: result.page.map((row) => ({
        id: row._id,
        userId: row.userId,
        apiKey: row.apiKey,
        updatedAt: row.updatedAt,
        secretKeyId: row.secretKeyId,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listMcpCredentialPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("mcpCredentials").paginate(args.paginationOpts);
    return {
      page: result.page.map((row) => ({
        id: row._id,
        userId: row.userId,
        connectionId: row.connectionId,
        issuerOrOrigin: row.issuerOrOrigin,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        credentialValue: row.credentialValue,
        clientSecret: row.clientSecret,
        refreshRevision: row.refreshRevision,
        secretKeyId: row.secretKeyId,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
