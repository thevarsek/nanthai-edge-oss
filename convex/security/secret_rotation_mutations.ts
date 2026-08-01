import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import { parseSecretEnvelope } from "../lib/secret_crypto";

const executionArgs = {
  rotationId: v.id("secretCryptoRotations"),
  executionAttemptId: v.id("executionAttempts"),
  executionFence: v.number(),
  claimantId: v.string(),
};

async function assertRotationWriter(
  ctx: MutationCtx,
  args: {
    rotationId: Id<"secretCryptoRotations">;
    executionAttemptId: Id<"executionAttempts">;
    executionFence: number;
    claimantId: string;
  },
) {
  const current = await assertCurrentExecution(ctx, {
    attemptId: args.executionAttemptId,
    fence: args.executionFence,
    claimantId: args.claimantId,
  });
  if (current.run.domainType !== "secret_crypto_rotation"
    || current.run.domainId !== String(args.rotationId)) {
    throw new Error("INVALID_ROTATION_EXECUTION_OWNER");
  }
  const now = Date.now();
  await ctx.db.patch(current.attempt._id, {
    heartbeatAt: now,
    leaseExpiresAt: now + 20 * 60 * 1_000,
    updatedAt: now,
  });
  return current;
}

function assertTargetEnvelope(value: string, targetKeyId: string, allowEmpty = false): void {
  if (allowEmpty && value === "") return;
  if (parseSecretEnvelope(value)?.keyId !== targetKeyId) {
    throw new Error("INVALID_ROTATION_TARGET_ENVELOPE");
  }
}

export const applyOAuthPage = internalMutation({
  args: {
    ...executionArgs,
    targetKeyId: v.string(),
    dryRun: v.boolean(),
    entries: v.array(v.object({
      id: v.id("oauthConnections"),
      originalAccessToken: v.string(),
      originalRefreshToken: v.string(),
      originalLastRefreshedAt: v.optional(v.number()),
      encryptedAccessToken: v.string(),
      encryptedRefreshToken: v.string(),
    })),
    scannedCount: v.number(),
    failureCount: v.number(),
    lastSafeErrorCode: v.optional(v.string()),
    cursor: v.string(),
    isDone: v.boolean(),
  },
  returns: v.object({ migratedCount: v.number(), conflictCount: v.number() }),
  handler: async (ctx, args) => {
    await assertRotationWriter(ctx, args);
    let migratedCount = 0;
    let conflictCount = 0;
    if (!args.dryRun) {
      for (const entry of args.entries) {
        assertTargetEnvelope(entry.encryptedAccessToken, args.targetKeyId);
        assertTargetEnvelope(entry.encryptedRefreshToken, args.targetKeyId, true);
        const row = await ctx.db.get(entry.id);
        if (!row
          || row.accessToken !== entry.originalAccessToken
          || row.refreshToken !== entry.originalRefreshToken
          || row.lastRefreshedAt !== entry.originalLastRefreshedAt) {
          conflictCount += 1;
          continue;
        }
        await ctx.db.patch(row._id, {
          accessToken: entry.encryptedAccessToken,
          refreshToken: entry.encryptedRefreshToken,
          secretEnvelopeVersion: 2,
          secretKeyId: args.targetKeyId,
          secretMigratedAt: Date.now(),
        });
        migratedCount += 1;
      }
    }
    const rotation = await ctx.db.get(args.rotationId);
    if (!rotation) throw new Error("SECRET_ROTATION_NOT_FOUND");
    await ctx.db.patch(rotation._id, {
      cursor: args.isDone ? undefined : args.cursor,
      scannedCount: rotation.scannedCount + args.scannedCount,
      migratedCount: rotation.migratedCount + migratedCount,
      conflictCount: rotation.conflictCount + conflictCount,
      failureCount: rotation.failureCount + args.failureCount,
      lastSafeErrorCode: args.lastSafeErrorCode ?? rotation.lastSafeErrorCode,
      updatedAt: Date.now(),
    });
    return { migratedCount, conflictCount };
  },
});

export const applyUserSecretPage = internalMutation({
  args: {
    ...executionArgs,
    targetKeyId: v.string(),
    dryRun: v.boolean(),
    entries: v.array(v.object({
      id: v.id("userSecrets"),
      originalApiKey: v.string(),
      originalUpdatedAt: v.number(),
      encryptedApiKey: v.string(),
    })),
    scannedCount: v.number(),
    failureCount: v.number(),
    lastSafeErrorCode: v.optional(v.string()),
    cursor: v.string(),
    isDone: v.boolean(),
  },
  returns: v.object({ migratedCount: v.number(), conflictCount: v.number() }),
  handler: async (ctx, args) => {
    await assertRotationWriter(ctx, args);
    let migratedCount = 0;
    let conflictCount = 0;
    if (!args.dryRun) {
      for (const entry of args.entries) {
        assertTargetEnvelope(entry.encryptedApiKey, args.targetKeyId);
        const row = await ctx.db.get(entry.id);
        if (!row || row.apiKey !== entry.originalApiKey || row.updatedAt !== entry.originalUpdatedAt) {
          conflictCount += 1;
          continue;
        }
        await ctx.db.patch(row._id, {
          apiKey: entry.encryptedApiKey,
          secretEnvelopeVersion: 2,
          secretKeyId: args.targetKeyId,
          secretMigratedAt: Date.now(),
          updatedAt: Date.now(),
        });
        migratedCount += 1;
      }
    }
    const rotation = await ctx.db.get(args.rotationId);
    if (!rotation) throw new Error("SECRET_ROTATION_NOT_FOUND");
    await ctx.db.patch(rotation._id, {
      cursor: args.isDone ? undefined : args.cursor,
      scannedCount: rotation.scannedCount + args.scannedCount,
      migratedCount: rotation.migratedCount + migratedCount,
      conflictCount: rotation.conflictCount + conflictCount,
      failureCount: rotation.failureCount + args.failureCount,
      lastSafeErrorCode: args.lastSafeErrorCode ?? rotation.lastSafeErrorCode,
      updatedAt: Date.now(),
    });
    return { migratedCount, conflictCount };
  },
});

export const applyMcpCredentialPage = internalMutation({
  args: {
    ...executionArgs,
    targetKeyId: v.string(),
    dryRun: v.boolean(),
    entries: v.array(v.object({
      id: v.id("mcpCredentials"),
      originalRefreshRevision: v.number(),
      originalAccessToken: v.optional(v.string()),
      originalRefreshToken: v.optional(v.string()),
      originalCredentialValue: v.optional(v.string()),
      originalClientSecret: v.optional(v.string()),
      encryptedAccessToken: v.optional(v.string()),
      encryptedRefreshToken: v.optional(v.string()),
      encryptedCredentialValue: v.optional(v.string()),
      encryptedClientSecret: v.optional(v.string()),
    })),
    scannedCount: v.number(),
    failureCount: v.number(),
    lastSafeErrorCode: v.optional(v.string()),
    cursor: v.string(),
    isDone: v.boolean(),
  },
  returns: v.object({ migratedCount: v.number(), conflictCount: v.number() }),
  handler: async (ctx, args) => {
    await assertRotationWriter(ctx, args);
    let migratedCount = 0;
    let conflictCount = 0;
    if (!args.dryRun) {
      for (const entry of args.entries) {
        for (const value of [
          entry.encryptedAccessToken,
          entry.encryptedRefreshToken,
          entry.encryptedCredentialValue,
          entry.encryptedClientSecret,
        ]) {
          if (value) assertTargetEnvelope(value, args.targetKeyId);
        }
        const row = await ctx.db.get(entry.id);
        if (!row
          || row.refreshRevision !== entry.originalRefreshRevision
          || row.accessToken !== entry.originalAccessToken
          || row.refreshToken !== entry.originalRefreshToken
          || row.credentialValue !== entry.originalCredentialValue
          || row.clientSecret !== entry.originalClientSecret) {
          conflictCount += 1;
          continue;
        }
        await ctx.db.patch(row._id, {
          accessToken: entry.encryptedAccessToken,
          refreshToken: entry.encryptedRefreshToken,
          credentialValue: entry.encryptedCredentialValue,
          clientSecret: entry.encryptedClientSecret,
          refreshRevision: row.refreshRevision + 1,
          secretEnvelopeVersion: 2,
          secretKeyId: args.targetKeyId,
          secretMigratedAt: Date.now(),
          updatedAt: Date.now(),
        });
        migratedCount += 1;
      }
    }
    const rotation = await ctx.db.get(args.rotationId);
    if (!rotation) throw new Error("SECRET_ROTATION_NOT_FOUND");
    await ctx.db.patch(rotation._id, {
      cursor: args.isDone ? undefined : args.cursor,
      scannedCount: rotation.scannedCount + args.scannedCount,
      migratedCount: rotation.migratedCount + migratedCount,
      conflictCount: rotation.conflictCount + conflictCount,
      failureCount: rotation.failureCount + args.failureCount,
      lastSafeErrorCode: args.lastSafeErrorCode ?? rotation.lastSafeErrorCode,
      updatedAt: Date.now(),
    });
    return { migratedCount, conflictCount };
  },
});

export const setRotationPhase = internalMutation({
  args: {
    ...executionArgs,
    status: v.union(v.literal("dry_run"), v.literal("running"), v.literal("verifying"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    table: v.union(
      v.literal("oauthConnections"),
      v.literal("userSecrets"),
      v.literal("mcpCredentials"),
    ),
    lastSafeErrorCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRotationWriter(ctx, args);
    const rotation = await ctx.db.get(args.rotationId);
    if (!rotation) throw new Error("SECRET_ROTATION_NOT_FOUND");
    await ctx.db.patch(rotation._id, {
      status: args.status,
      table: args.table,
      cursor: undefined,
      lastSafeErrorCode: args.lastSafeErrorCode ?? rotation.lastSafeErrorCode,
      completedAt: ["completed", "failed", "cancelled"].includes(args.status)
        ? Date.now()
        : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
