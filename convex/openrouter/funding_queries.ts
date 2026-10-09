import type { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { fundingState, resolveFreeModel, type FundingModel } from "./funding_policy";

export async function readFundingContext(ctx: Pick<QueryCtx, "db">, userId: string, models: FundingModel[], prefs?: { zdrEnabled?: boolean; disabledProviders?: string[] } | null) {
  const secret = await ctx.db.query("userSecrets").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const state = fundingState(secret?.openRouterAccount);
  const requireZdr = prefs?.zdrEnabled === true;
  return { state, requireZdr, freeModelId: resolveFreeModel(models, requireZdr, prefs?.disabledProviders) };
}

export async function modelFundingContext(ctx: QueryCtx, models: FundingModel[]) {
  const identity = await optionalAuth(ctx);
  if (!identity) return { state: "unknown" as const, requireZdr: false, freeModelId: undefined, pickerFilterFree: false, pickerFilterExcludeFree: false };
  const prefs = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", identity.userId)).first();
  const context = await readFundingContext(ctx, identity.userId, models, prefs);
  const preferFree = context.state !== "unknown" && context.state !== "funded";
  return { ...context, pickerFilterExcludeFree: prefs?.pickerFilterExcludeFree === true, pickerFilterFree: !prefs?.pickerFilterFreeUserSet && !prefs?.pickerFilterExcludeFree && preferFree
    ? true : prefs?.pickerFilterFree === true };

}
