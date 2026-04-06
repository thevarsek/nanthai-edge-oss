import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

type UserSecretContext = Pick<ActionCtx, "runQuery">;

export async function getOptionalUserOpenRouterApiKey(
  ctx: UserSecretContext,
  userId: string,
): Promise<string | null> {
  return await ctx.runQuery(internal.scheduledJobs.queries.getUserApiKey, {
    userId,
  });
}

export async function getRequiredUserOpenRouterApiKey(
  ctx: UserSecretContext,
  userId: string,
): Promise<string> {
  const apiKey = await getOptionalUserOpenRouterApiKey(ctx, userId);
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("[MISSING_API_KEY] No OpenRouter API key found. Reconnect OpenRouter in Settings.");
  }
  return apiKey;
}
