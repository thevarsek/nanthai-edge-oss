import { OPENROUTER_ACTION_BUDGET_MS } from "../lib/openrouter_constants";

/**
 * Provider work is bounded from the first participant action entry. The
 * remaining minute belongs to stream flushing, checkpoint persistence, and
 * terminal hooks before Convex's ten-minute action ceiling.
 */
export const GENERATION_FINALIZATION_RESERVE_MS = 60_000;

export function resolveGenerationProviderDeadline(
  inheritedDeadlineAt: number | undefined,
  actionEnteredAt: number,
): number {
  const localDeadlineAt = actionEnteredAt + OPENROUTER_ACTION_BUDGET_MS;
  if (inheritedDeadlineAt === undefined || !Number.isFinite(inheritedDeadlineAt)) {
    return localDeadlineAt;
  }
  return Math.min(inheritedDeadlineAt, localDeadlineAt);
}

export function generationBudgetStartedAt(
  providerDeadlineAt: number,
  currentActionEnteredAt: number,
): number {
  return Math.min(
    currentActionEnteredAt,
    providerDeadlineAt - OPENROUTER_ACTION_BUDGET_MS,
  );
}
