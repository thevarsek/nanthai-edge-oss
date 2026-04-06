// convex/models/guidance_scoring_wizard.ts
// =============================================================================
// Wizard ranking formulas and trend hint logic. Separated from the core
// scoring file to keep each under the 300-line limit.
// =============================================================================

import type { NormalizedMetrics } from "./guidance_scoring";

// -- Wizard ranking formulas --------------------------------------------------

export type WizardTask =
  | "everydayHelp"
  | "coding"
  | "researchStudy"
  | "writingMarketing"
  | "translation"
  | "images";

export type WizardPriority = "quality" | "speed" | "value";

/**
 * Compute a wizard ranking score for a text model given task + priority.
 */
export function computeWizardTextScore(
  m: NormalizedMetrics,
  task: WizardTask,
  priority: WizardPriority,
): number {
  if (task === "everydayHelp") {
    if (priority === "quality") {
      return 0.50 * m.I + 0.15 * m.A + 0.10 * m.S + 0.10 * m.T + 0.15 * m.P;
    }
    if (priority === "speed") {
      return 0.45 * m.S + 0.30 * m.T + 0.15 * m.I + 0.10 * m.P;
    }
    return 0.40 * m.I + 0.35 * m.P + 0.15 * m.S + 0.10 * m.T;
  }

  if (task === "coding") {
    if (priority === "quality") {
      return 0.60 * m.C + 0.20 * m.I + 0.10 * m.A + 0.05 * m.S + 0.05 * m.P;
    }
    if (priority === "speed") {
      return 0.40 * m.C + 0.25 * m.S + 0.15 * m.T + 0.15 * m.I + 0.05 * m.P;
    }
    return 0.45 * m.C + 0.30 * m.P + 0.10 * m.S + 0.10 * m.I + 0.05 * m.T;
  }

  if (task === "researchStudy") {
    if (priority === "quality") {
      return 0.45 * m.I + 0.25 * m.A + 0.15 * m.X + 0.05 * m.S + 0.10 * m.P;
    }
    if (priority === "speed") {
      return (
        0.30 * m.I +
        0.20 * m.A +
        0.15 * m.X +
        0.20 * m.S +
        0.10 * m.T +
        0.05 * m.P
      );
    }
    return 0.35 * m.I + 0.20 * m.A + 0.20 * m.X + 0.20 * m.P + 0.05 * m.S;
  }

  if (task === "writingMarketing") {
    if (priority === "quality") {
      return 0.55 * m.I + 0.20 * m.S + 0.10 * m.T + 0.15 * m.P;
    }
    if (priority === "speed") {
      return 0.40 * m.S + 0.25 * m.T + 0.20 * m.I + 0.15 * m.P;
    }
    return 0.35 * m.I + 0.40 * m.P + 0.15 * m.S + 0.10 * m.T;
  }

  if (task === "translation") {
    if (priority === "quality") {
      return 0.50 * m.I + 0.20 * m.S + 0.10 * m.T + 0.20 * m.P;
    }
    if (priority === "speed") {
      return 0.45 * m.S + 0.25 * m.T + 0.15 * m.I + 0.15 * m.P;
    }
    return 0.30 * m.I + 0.45 * m.P + 0.15 * m.S + 0.10 * m.T;
  }

  // Fallback to recommended
  return 0.50 * m.I + 0.15 * m.A + 0.10 * m.S + 0.10 * m.T + 0.15 * m.P;
}

/**
 * Compute a wizard ranking score for an image model given priority.
 */
export function computeWizardImageScore(
  m: NormalizedMetrics,
  priority: WizardPriority,
): number {
  if (priority === "quality") {
    return 0.80 * m.E + 0.20 * m.R;
  }
  // value
  return 0.55 * m.E + 0.20 * m.R + 0.25 * m.P;
}

// -- Trend hint logic ---------------------------------------------------------

export type TrendHint = "Popular now" | "Trending" | null;

/**
 * Determine trend hint for a model in a given OpenRouter category.
 */
export function getTrendHint(
  useCases: { category: string; returnedRank: number }[] | undefined,
  category: string | undefined,
): TrendHint {
  if (!useCases || !category) return null;

  const entry = useCases.find((uc) => uc.category === category);
  if (!entry) return null;

  if (entry.returnedRank <= 3) return "Popular now";
  if (entry.returnedRank <= 10) return "Trending";
  return null;
}

/**
 * Map wizard task to OpenRouter category for trend hints.
 */
export function taskToOpenRouterCategory(
  task: WizardTask,
): string | undefined {
  const map: Partial<Record<WizardTask, string>> = {
    everydayHelp: "trivia",
    coding: "programming",
    researchStudy: "academia",
    writingMarketing: "marketing",
    translation: "translation",
  };
  return map[task];
}

/**
 * Map wizard task to the corresponding picker sort key for "See all models".
 */
export function taskToPickerSortKey(task: WizardTask): string {
  const map: Record<WizardTask, string> = {
    everydayHelp: "recommended",
    coding: "coding",
    researchStudy: "research",
    writingMarketing: "recommended",
    translation: "recommended",
    images: "image",
  };
  return map[task];
}
