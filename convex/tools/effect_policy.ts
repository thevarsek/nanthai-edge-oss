import type { ToolEffect, ToolRetryPolicy } from "../execution/validators";

export interface ToolEffectPolicy {
  effect: ToolEffect;
  retry: ToolRetryPolicy;
}
