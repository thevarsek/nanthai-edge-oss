import type { Doc } from "../_generated/dataModel";
import type { OpenRouterUsage } from "../lib/openrouter_types";

export function effectiveUsageCost(
  usage: OpenRouterUsage | undefined,
): number | undefined {
  return usage?.isByok === true && usage.upstreamInferenceCost != null
    ? usage.upstreamInferenceCost
    : usage?.cost;
}

export function terminalStage(
  status: Extract<
    Doc<"advisorRuns">["status"],
    "completed" | "failed" | "timedOut" | "cancelled"
  >,
): Doc<"advisorRuns">["stage"] {
  if (status === "timedOut") return "timed_out";
  return status;
}
