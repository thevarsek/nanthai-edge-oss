import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { decryptSecret, userApiKeySecretContext } from "../lib/secret_crypto";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";
import { accountSnapshotValidator, parseAccountSnapshot } from "./funding_policy";

export const getConnection = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => ctx.db.query("userSecrets").withIndex("by_user", q => q.eq("userId", userId)).unique(),
});

export const saveSnapshot = internalMutation({
  args: { connectionId: v.id("userSecrets"), connectionUpdatedAt: v.number(), snapshot: accountSnapshotValidator },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.updatedAt !== args.connectionUpdatedAt
      || (connection.openRouterAccount?.checkedAt ?? 0) > args.snapshot.checkedAt) return false;
    await ctx.db.patch(connection._id, { openRouterAccount: args.snapshot });
    return true;
  },
});

/** Refreshes account and per-key state together; never treats a failed lookup as zero. */
export async function fetchAccountCredits(ctx: ActionCtx): Promise<{ balance: number }> {
  const { userId } = await requireAuth(ctx);
  const connection = await ctx.runQuery(internal.openrouter.account.getConnection, { userId });
  if (!connection) throw new ConvexError({ code: "NOT_FOUND", message: "No OpenRouter API key found. Please connect OpenRouter first." });
  const apiKey = await decryptSecret(connection.apiKey, userApiKeySecretContext(userId));
  const checkedAt = Date.now();
  const headers = { Authorization: `Bearer ${apiKey}`, "HTTP-Referer": HTTP_REFERER, "X-Title": X_TITLE };
  const read = async (path: string): Promise<unknown> => {
    const response = await fetch(`https://openrouter.ai/api/v1/${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return response.json();
  };
  const results = await Promise.allSettled([read("credits"), read("key")]);
  const snapshot = parseAccountSnapshot(
    results[0].status === "fulfilled" ? results[0].value : null,
    results[1].status === "fulfilled" ? results[1].value : null,
    checkedAt,
  );
  const saved = await ctx.runMutation(internal.openrouter.account.saveSnapshot, {
    connectionId: connection._id, connectionUpdatedAt: connection.updatedAt, snapshot,
  });
  if (!saved || snapshot.balance === null) throw new ConvexError({ code: "EXTERNAL_SERVICE", message: "OpenRouter account balance could not be checked. Please try again." });
  return { balance: snapshot.balance };
}
