import type { Doc } from "../_generated/dataModel";
import type { NonTerminalAdapterEvent } from "./protocol_adapter_events";

type RuntimeUsage = NonNullable<Doc<"generationJobs">["runtimeUsage"]>;
type UsageEvent = Extract<NonTerminalAdapterEvent, { type: "usage_reported" }>;

// The caller accepts each fenced worker sequence once before applying usage.
export function aggregateRuntimeUsage(
  previous: RuntimeUsage | undefined,
  event: UsageEvent,
): RuntimeUsage {
  const incoming: RuntimeUsage = {
    actualProvider: event.actualModel?.provider ?? undefined,
    actualModelId: event.actualModel?.modelId,
    inputTokens: event.tokens.input ?? undefined,
    outputTokens: event.tokens.output ?? undefined,
    cachedInputTokens: event.tokens.cachedInput ?? undefined,
    reasoningTokens: event.tokens.reasoning ?? undefined,
    totalTokens: event.tokens.total ?? undefined,
    costSource: event.cost.source,
    costAmount: event.cost.source === "unpriced" ? undefined : event.cost.amount,
    costCurrency: event.cost.source === "unpriced" ? undefined : event.cost.currency,
    pricingVersion: event.cost.source === "api_equivalent_estimate"
      ? event.cost.pricingVersion : undefined,
    unpricedReason: event.cost.source === "unpriced" ? event.cost.reason : undefined,
  };
  if (!previous) return incoming;
  const combinedCost = previous.costAmount !== undefined && incoming.costAmount !== undefined
    ? previous.costAmount + incoming.costAmount : undefined;
  const compatiblePrice = previous.costSource !== "unpriced"
    && previous.costSource === incoming.costSource
    && previous.costCurrency === incoming.costCurrency
    && previous.pricingVersion === incoming.pricingVersion
    && combinedCost !== undefined;
  return {
    ...incoming,
    inputTokens: sumKnown(previous.inputTokens, incoming.inputTokens),
    outputTokens: sumKnown(previous.outputTokens, incoming.outputTokens),
    cachedInputTokens: sumKnown(previous.cachedInputTokens, incoming.cachedInputTokens),
    reasoningTokens: sumKnown(previous.reasoningTokens, incoming.reasoningTokens),
    totalTokens: sumKnown(previous.totalTokens, incoming.totalTokens),
    costSource: compatiblePrice ? incoming.costSource : "unpriced",
    costAmount: compatiblePrice ? combinedCost : undefined,
    costCurrency: compatiblePrice ? incoming.costCurrency : undefined,
    pricingVersion: compatiblePrice ? incoming.pricingVersion : undefined,
    unpricedReason: compatiblePrice ? undefined : previous.unpricedReason
      ?? incoming.unpricedReason ?? "Runtime reports have different cost attribution",
  };
}

function sumKnown(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}
