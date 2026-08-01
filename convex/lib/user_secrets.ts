import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { decryptSecret, userApiKeySecretContext } from "./secret_crypto";

type UserSecretContext = Pick<ActionCtx, "runQuery">;

export async function getOptionalUserOpenRouterApiKey(
  ctx: UserSecretContext,
  userId: string,
): Promise<string | null> {
  const encryptedApiKey = await ctx.runQuery(
    internal.scheduledJobs.queries.getEncryptedUserApiKey,
    {
      userId,
    },
  );
  if (!encryptedApiKey) return null;
  return await decryptSecret(encryptedApiKey, userApiKeySecretContext(userId));
}

export async function getRequiredUserOpenRouterApiKey(
  ctx: UserSecretContext,
  userId: string,
): Promise<string> {
  const apiKey = await getOptionalUserOpenRouterApiKey(ctx, userId);
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ConvexError({ code: "MISSING_API_KEY" as const, message: "No OpenRouter API key found. Reconnect OpenRouter in Settings." });
  }
  return apiKey;
}
