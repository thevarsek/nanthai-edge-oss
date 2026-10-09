import type { MutationCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { fundingState, isFreeOpenRouterModel, resolveFreeModel } from "../openrouter/funding_policy";

/** Persist the compatible default in the same transaction as enabling ZDR. */
export async function defaultModelWhenEnablingZdr(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
  current: { defaultModelId?: string; disabledProviders?: string[] | null },
): Promise<{ defaultModelId: string; disableSearch: boolean } | undefined> {
  const models = await ctx.db.query("cachedModels").take(2000);
  const selected = models.find(model => model.modelId === (current.defaultModelId ?? MODEL_IDS.appDefault));
  if (selected?.hasZdrEndpoint === true) return undefined;
  const secret = await ctx.db.query("userSecrets").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const state = fundingState(secret?.openRouterAccount);
  const unfunded = state !== "unknown" && state !== "funded";
  const preferFree = isFreeOpenRouterModel(current.defaultModelId ?? "") || unfunded;
  const appDefault = models.find(model => model.modelId === MODEL_IDS.appDefault);
  if (!preferFree && appDefault?.hasZdrEndpoint === true
    && !current.disabledProviders?.includes(appDefault.provider ?? "")) return { defaultModelId: appDefault.modelId, disableSearch: false };
  const free = resolveFreeModel(models, true, current.disabledProviders ?? []);
  return free ? { defaultModelId: free, disableSearch: unfunded } : undefined;
}
