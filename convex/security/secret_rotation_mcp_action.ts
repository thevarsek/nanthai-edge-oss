import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import {
  decryptSecret,
  encryptSecret,
  mcpCredentialSecretContext,
  parseSecretEnvelope,
} from "../lib/secret_crypto";

type SecretField = "accessToken" | "refreshToken" | "credentialValue" | "clientSecret";
type McpCredentialRow = {
  id: Id<"mcpCredentials">;
  userId: string;
  connectionId: Id<"mcpConnections">;
  issuerOrOrigin: string;
  accessToken?: string;
  refreshToken?: string;
  credentialValue?: string;
  clientSecret?: string;
  refreshRevision: number;
};
type McpCredentialPage = {
  page: McpCredentialRow[];
  isDone: boolean;
  continueCursor: string;
};
type McpRotationEntry = {
  id: Id<"mcpCredentials">;
  originalRefreshRevision: number;
  originalAccessToken?: string;
  originalRefreshToken?: string;
  originalCredentialValue?: string;
  originalClientSecret?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  encryptedCredentialValue?: string;
  encryptedClientSecret?: string;
};
type RotationPageResult = { isDone: boolean; cursor: string; failureCount: number };

async function rotateField(args: {
  row: McpCredentialRow;
  field: SecretField;
  value?: string;
  targetKeyId: string;
  verifying: boolean;
}): Promise<string | undefined> {
  if (!args.value) return undefined;
  const context = mcpCredentialSecretContext({
    userId: args.row.userId,
    connectionId: args.row.connectionId.toString(),
    issuerOrOrigin: args.row.issuerOrOrigin,
    field: args.field,
  });
  const plaintext = await decryptSecret(args.value, context);
  const alreadyTarget = parseSecretEnvelope(args.value)?.keyId === args.targetKeyId;
  if (args.verifying && !alreadyTarget) throw new Error("NON_TARGET_ENVELOPE");
  const encrypted = alreadyTarget || args.verifying
    ? args.value
    : await encryptSecret(plaintext, context, undefined, args.targetKeyId);
  if (!args.verifying && await decryptSecret(encrypted, context) !== plaintext) {
    throw new Error("ROTATION_ROUND_TRIP_FAILED");
  }
  return encrypted;
}

export const processMcpRotationPage = internalAction({
  args: {
    rotationId: v.id("secretCryptoRotations"),
    cursor: v.optional(v.string()),
    targetKeyId: v.string(),
    dryRun: v.boolean(),
    verifying: v.boolean(),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    claimantId: v.string(),
  },
  returns: v.object({ isDone: v.boolean(), cursor: v.string(), failureCount: v.number() }),
  handler: async (ctx, args): Promise<RotationPageResult> => {
    const page: McpCredentialPage = await ctx.runQuery(
      internal.security.secret_rotation_queries.listMcpCredentialPage,
      { paginationOpts: { numItems: 50, cursor: args.cursor ?? null } },
    );
    const entries: McpRotationEntry[] = [];
    let failureCount = 0;
    for (const row of page.page) {
      try {
        const typedRow: McpCredentialRow = row;
        const encryptedAccessToken = await rotateField({
          row: typedRow, field: "accessToken", value: row.accessToken,
          targetKeyId: args.targetKeyId, verifying: args.verifying,
        });
        const encryptedRefreshToken = await rotateField({
          row: typedRow, field: "refreshToken", value: row.refreshToken,
          targetKeyId: args.targetKeyId, verifying: args.verifying,
        });
        const encryptedCredentialValue = await rotateField({
          row: typedRow, field: "credentialValue", value: row.credentialValue,
          targetKeyId: args.targetKeyId, verifying: args.verifying,
        });
        const encryptedClientSecret = await rotateField({
          row: typedRow, field: "clientSecret", value: row.clientSecret,
          targetKeyId: args.targetKeyId, verifying: args.verifying,
        });
        const alreadyTarget = [row.accessToken, row.refreshToken, row.credentialValue, row.clientSecret]
          .filter((value): value is string => Boolean(value))
          .every((value) => parseSecretEnvelope(value)?.keyId === args.targetKeyId);
        if (!alreadyTarget && !args.verifying) {
          entries.push({
            id: row.id,
            originalRefreshRevision: row.refreshRevision,
            originalAccessToken: row.accessToken,
            originalRefreshToken: row.refreshToken,
            originalCredentialValue: row.credentialValue,
            originalClientSecret: row.clientSecret,
            encryptedAccessToken,
            encryptedRefreshToken,
            encryptedCredentialValue,
            encryptedClientSecret,
          });
        }
      } catch {
        failureCount += 1;
      }
    }
    await ctx.runMutation(internal.security.secret_rotation_mutations.applyMcpCredentialPage, {
      rotationId: args.rotationId,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      claimantId: args.claimantId,
      targetKeyId: args.targetKeyId,
      dryRun: args.dryRun || args.verifying,
      entries,
      scannedCount: page.page.length,
      failureCount,
      lastSafeErrorCode: failureCount > 0 ? "CREDENTIAL_UNAVAILABLE" : undefined,
      cursor: page.continueCursor,
      isDone: page.isDone,
    });
    return { isDone: page.isDone, cursor: page.continueCursor, failureCount };
  },
});
