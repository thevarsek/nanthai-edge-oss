import { v } from "convex/values";
import { MODEL_IDS, OPENROUTER_FREE_ROUTER_ID } from "../lib/model_constants";
import { isExcludedOpenRouterProvider, isEligibleModel } from "../models/model_filters";

export const accountSnapshotValidator = v.object({
  balance: v.union(v.number(), v.null()),
  keyLimitRemaining: v.union(v.number(), v.null()),
  keyLimitKnown: v.boolean(),
  keyLimitReset: v.union(v.string(), v.null()),
  checkedAt: v.number(),
});
export interface AccountSnapshot {
  balance: number | null;
  keyLimitRemaining: number | null;
  keyLimitKnown: boolean;
  keyLimitReset: string | null;
  checkedAt: number;
}
export type FundingState = "unknown" | "funded" | "no_credits" | "negative_balance" | "key_limit";

/** Only an automatically assigned free default changes search; explicit overrides win. */
export function fundingAwareSearchDefault(
  prefs: { defaultModelId?: string; webSearchEnabledByDefault: boolean; webSearchDefaultUserSet?: boolean },
  state: FundingState,
  freeModelId?: string,
): boolean {
  const automaticFree = !prefs.defaultModelId && Boolean(freeModelId) && state !== "unknown" && state !== "funded";
  return automaticFree && !prefs.webSearchDefaultUserSet ? false : prefs.webSearchEnabledByDefault;
}
export interface FundingModel {
  modelId: string;
  hasZdrEndpoint?: boolean;
  supportsTools?: boolean;
  contextLength?: number;
  outputPricePer1M?: number;
  provider?: string | null;
  architecture?: { modality?: string };
}
export interface FundingGuidance {
  code: "no_credits" | "negative_balance" | "key_limit" | "free_zdr_unavailable" | "zdr_incompatible";
  freeModelId?: string;
  actions: ("openrouter_credits" | "openrouter_keys" | "choose_free_model" | "privacy_settings")[];
}

/** Free routes are explicit: token price zero does not imply free media generation. */
export function isFreeOpenRouterModel(modelId: string): boolean {
  return modelId === OPENROUTER_FREE_ROUTER_ID || modelId.endsWith(":free");
}

export function fundingState(snapshot: AccountSnapshot | null | undefined, now = Date.now()): FundingState {
  // A stale/failed check must never masquerade as a confirmed empty account.
  if (!snapshot || now - snapshot.checkedAt > 5 * 60_000 || snapshot.checkedAt > now) return "unknown";
  if (snapshot.balance !== null && snapshot.balance < 0) return "negative_balance";
  if (snapshot.keyLimitKnown && snapshot.keyLimitRemaining !== null && snapshot.keyLimitRemaining <= 0) return "key_limit";
  if (snapshot.balance === 0) return "no_credits";
  if (snapshot.balance !== null && snapshot.balance > 0 && snapshot.keyLimitKnown) return "funded";
  return "unknown";
}

export function resolveFreeModel(models: FundingModel[], requireZdr: boolean, disabledProviders: string[] = []): string | undefined {
  const candidates = models.filter(model => isFreeOpenRouterModel(model.modelId)
    && !isExcludedOpenRouterProvider(model.provider)
    && !disabledProviders.includes(model.provider ?? "")
    && isEligibleModel(model)
    && (model.architecture?.modality ?? "").split("->")[1] === "text"
    && (!requireZdr || model.hasZdrEndpoint === true));
  const preferred = requireZdr ? MODEL_IDS.freeZdrDefault : MODEL_IDS.freeDefault;
  if (candidates.some(model => model.modelId === preferred)) return preferred;
  return candidates.sort((a, b) => Number(b.supportsTools === true) - Number(a.supportsTools === true)
    || a.modelId.localeCompare(b.modelId))[0]?.modelId;
}

export function projectModelFunding(model: FundingModel, state: FundingState, freeModelId: string | undefined, requireZdr: boolean): FundingGuidance | undefined {
  if (requireZdr && model.hasZdrEndpoint !== true) return {
    code: "zdr_incompatible", freeModelId,
    actions: [...(freeModelId ? ["choose_free_model" as const] : []), "privacy_settings"],
  };
  if (state === "unknown" || state === "funded") return undefined;
  if (state === "negative_balance") return { code: state, actions: ["openrouter_credits"] };
  // Free inference does not spend a key's dollar allowance.
  if (isFreeOpenRouterModel(model.modelId) && (!requireZdr || model.hasZdrEndpoint === true)) return undefined;
  if (requireZdr && !freeModelId) return { code: "free_zdr_unavailable", actions: ["openrouter_credits", "privacy_settings", ...(state === "key_limit" ? ["openrouter_keys" as const] : [])] };
  return {
    code: state,
    freeModelId,
    actions: [state === "key_limit" ? "openrouter_keys" : "openrouter_credits", ...(freeModelId ? ["choose_free_model" as const] : [])],
  };
}

export function parseAccountSnapshot(credits: unknown, key: unknown, checkedAt: number): AccountSnapshot {
  const data = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object") return {};
    const nested = (value as Record<string, unknown>).data;
    return nested && typeof nested === "object" ? nested as Record<string, unknown> : {};
  };
  const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const c = data(credits), k = data(key);
  const remaining = number(c.remaining_credits) ?? number(c.remaining);
  const total = number(c.total_credits), usage = number(c.total_usage);
  return {
    balance: remaining ?? (total !== null && usage !== null ? total - usage : null),
    keyLimitRemaining: number(k.limit_remaining),
    keyLimitKnown: k.limit === null || number(k.limit_remaining) !== null,
    keyLimitReset: typeof k.limit_reset === "string" ? k.limit_reset : null,
    checkedAt,
  };
}
