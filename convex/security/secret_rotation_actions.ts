import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  decryptOAuthCredentials,
  decryptSecret,
  encryptOAuthCredentials,
  encryptSecret,
  parseSecretEnvelope,
  userApiKeySecretContext,
} from "../lib/secret_crypto";

const pageArgs = {
  rotationId: v.id("secretCryptoRotations"),
  table: v.union(v.literal("oauthConnections"), v.literal("userSecrets")),
  cursor: v.optional(v.string()),
  targetKeyId: v.string(),
  dryRun: v.boolean(),
  verifying: v.boolean(),
  executionAttemptId: v.id("executionAttempts"),
  executionFence: v.number(),
  claimantId: v.string(),
};

const pageResult = v.object({
  isDone: v.boolean(),
  cursor: v.string(),
  failureCount: v.number(),
});

interface RotationPageResult {
  isDone: boolean;
  cursor: string;
  failureCount: number;
}

interface OAuthCredentialPage {
  page: Array<{
    id: Id<"oauthConnections">;
    userId: string;
    provider: string;
    accessToken: string;
    refreshToken: string;
    lastRefreshedAt?: number;
    secretKeyId?: string;
  }>;
  isDone: boolean;
  continueCursor: string;
}

interface UserSecretPage {
  page: Array<{
    id: Id<"userSecrets">;
    userId: string;
    apiKey: string;
    updatedAt: number;
    secretKeyId?: string;
  }>;
  isDone: boolean;
  continueCursor: string;
}

export const runSecretEncryptionCanary = internalAction({
  args: { keyId: v.string() },
  returns: v.object({
    ok: v.literal(true),
    keyId: v.string(),
    envelopeVersion: v.literal(2),
  }),
  handler: async (_ctx, args) => {
    const context = userApiKeySecretContext("system:secret-canary");
    const envelope = await encryptSecret("secret-canary", context, undefined, args.keyId);
    const metadata = parseSecretEnvelope(envelope);
    const plaintext = await decryptSecret(envelope, context);
    if (plaintext !== "secret-canary" || metadata?.keyId !== args.keyId) {
      throw new Error("SECRET_ENCRYPTION_CANARY_FAILED");
    }
    return { ok: true as const, keyId: args.keyId, envelopeVersion: 2 as const };
  },
});

function safeCryptoCode(): string {
  return "CREDENTIAL_UNAVAILABLE";
}

export const processRotationPage = internalAction({
  args: pageArgs,
  returns: pageResult,
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<RotationPageResult> => {
    if (args.table === "oauthConnections") {
      const page: OAuthCredentialPage = await ctx.runQuery(
        internal.security.secret_rotation_queries.listOAuthCredentialPage,
        { paginationOpts: { numItems: 50, cursor: args.cursor ?? null } },
      );
      const entries: Array<{
        id: Id<"oauthConnections">;
        originalAccessToken: string;
        originalRefreshToken: string;
        originalLastRefreshedAt?: number;
        encryptedAccessToken: string;
        encryptedRefreshToken: string;
      }> = [];
      let failureCount = 0;
      for (const row of page.page) {
        try {
          const plaintext = await decryptOAuthCredentials({
            userId: row.userId,
            provider: row.provider,
            accessToken: row.accessToken,
            refreshToken: row.refreshToken,
          });
          const alreadyTarget = parseSecretEnvelope(row.accessToken)?.keyId === args.targetKeyId
            && (row.refreshToken === ""
              || parseSecretEnvelope(row.refreshToken)?.keyId === args.targetKeyId);
          if (args.verifying && !alreadyTarget) throw new Error("NON_TARGET_ENVELOPE");
          const encrypted = alreadyTarget || args.verifying
            ? { encryptedAccessToken: row.accessToken, encryptedRefreshToken: row.refreshToken }
            : await encryptOAuthCredentials({
              userId: row.userId,
              provider: row.provider,
              accessToken: plaintext.accessToken,
              refreshToken: plaintext.refreshToken,
              keyId: args.targetKeyId,
            });
          if (!args.verifying && !alreadyTarget) {
            const checked = await decryptOAuthCredentials({
              userId: row.userId,
              provider: row.provider,
              accessToken: encrypted.encryptedAccessToken,
              refreshToken: encrypted.encryptedRefreshToken,
            });
            if (checked.accessToken !== plaintext.accessToken
              || checked.refreshToken !== plaintext.refreshToken) {
              throw new Error("ROTATION_ROUND_TRIP_FAILED");
            }
          }
          if (!alreadyTarget && !args.verifying) {
            entries.push({
              id: row.id,
              originalAccessToken: row.accessToken,
              originalRefreshToken: row.refreshToken,
              originalLastRefreshedAt: row.lastRefreshedAt,
              encryptedAccessToken: encrypted.encryptedAccessToken,
              encryptedRefreshToken: encrypted.encryptedRefreshToken,
            });
          }
        } catch {
          failureCount += 1;
        }
      }
      await ctx.runMutation(internal.security.secret_rotation_mutations.applyOAuthPage, {
        rotationId: args.rotationId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
        claimantId: args.claimantId,
        targetKeyId: args.targetKeyId,
        dryRun: args.dryRun || args.verifying,
        entries,
        scannedCount: page.page.length,
        failureCount,
        lastSafeErrorCode: failureCount > 0 ? safeCryptoCode() : undefined,
        cursor: page.continueCursor,
        isDone: page.isDone,
      });
      return { isDone: page.isDone, cursor: page.continueCursor, failureCount };
    }

    const page: UserSecretPage = await ctx.runQuery(
      internal.security.secret_rotation_queries.listUserSecretPage,
      { paginationOpts: { numItems: 50, cursor: args.cursor ?? null } },
    );
    const entries: Array<{
      id: Id<"userSecrets">;
      originalApiKey: string;
      originalUpdatedAt: number;
      encryptedApiKey: string;
    }> = [];
    let failureCount = 0;
    for (const row of page.page) {
      try {
        const context = userApiKeySecretContext(row.userId);
        const plaintext = await decryptSecret(row.apiKey, context);
        const alreadyTarget = parseSecretEnvelope(row.apiKey)?.keyId === args.targetKeyId;
        if (args.verifying && !alreadyTarget) throw new Error("NON_TARGET_ENVELOPE");
        const encryptedApiKey = alreadyTarget || args.verifying
          ? row.apiKey
          : await encryptSecret(plaintext, context, undefined, args.targetKeyId);
        if (!args.verifying && !alreadyTarget
          && await decryptSecret(encryptedApiKey, context) !== plaintext) {
          throw new Error("ROTATION_ROUND_TRIP_FAILED");
        }
        if (!alreadyTarget && !args.verifying) {
          entries.push({
            id: row.id,
            originalApiKey: row.apiKey,
            originalUpdatedAt: row.updatedAt,
            encryptedApiKey,
          });
        }
      } catch {
        failureCount += 1;
      }
    }
    await ctx.runMutation(internal.security.secret_rotation_mutations.applyUserSecretPage, {
      rotationId: args.rotationId,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      claimantId: args.claimantId,
      targetKeyId: args.targetKeyId,
      dryRun: args.dryRun || args.verifying,
      entries,
      scannedCount: page.page.length,
      failureCount,
      lastSafeErrorCode: failureCount > 0 ? safeCryptoCode() : undefined,
      cursor: page.continueCursor,
      isDone: page.isDone,
    });
    return { isDone: page.isDone, cursor: page.continueCursor, failureCount };
  },
});
