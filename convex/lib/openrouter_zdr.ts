import { ConvexError } from "convex/values";
import type { ChatRequestParameters } from "./openrouter_types";

export interface ZdrPreferenceLike {
  zdrEnabled?: boolean | null;
}

export interface ZdrCapabilityLike {
  hasZdrEndpoint?: boolean | null;
}

export function isZdrEnabled(
  prefs: ZdrPreferenceLike | null | undefined,
): boolean {
  return prefs?.zdrEnabled === true;
}

export function mergeZdrProvider(
  provider: ChatRequestParameters["provider"] | undefined | null,
  requireZdr: boolean,
): ChatRequestParameters["provider"] | undefined {
  if (!requireZdr) return provider ?? undefined;
  return {
    ...(provider ?? {}),
    zdr: true,
  };
}

export function withZdrProvider<T extends ChatRequestParameters>(
  params: T,
  requireZdr: boolean,
): T {
  if (!requireZdr) return params;
  return {
    ...params,
    provider: mergeZdrProvider(params.provider, true),
  };
}

export function selectAncillaryModelForZdr(params: {
  requestedModel?: string | null;
  defaultModel: string;
  requireZdr: boolean;
}): string {
  if (params.requireZdr) return params.defaultModel;
  const requested = params.requestedModel?.trim();
  return requested && requested.length > 0 ? requested : params.defaultModel;
}

export function assertModelSupportsZdr(params: {
  modelId: string;
  capabilities: ZdrCapabilityLike | null | undefined;
  feature: string;
}): void {
  if (params.capabilities?.hasZdrEndpoint === true) return;
  throw new ConvexError({
    code: "ZDR_MODEL_UNAVAILABLE" as const,
    message:
      `${params.feature} is unavailable with Zero Data Retention for ` +
      `${params.modelId}. Please choose a ZDR-compatible model or turn off ZDR.`,
  });
}
