// convex/models/guidance_scoring_labels.ts
// =============================================================================
// Rank-based label derivation: assigns locale-agnostic semantic keys like
// "coding.best", "fast.top", "image.best" based on each model's rank within
// the scored pool. Only top-N models per category receive labels.
//
// Keys follow the pattern: "{category}.{tier}"
//   tier "best" = rank 1, tier "top" = rank 2..TOP_N
//
// iOS/Android clients map these keys to localized display strings.
// =============================================================================

import type { DerivedScores } from "./guidance_scoring";

// -- Configuration ------------------------------------------------------------

/** Maximum rank that receives a label per category. */
const TOP_N = 3;

/**
 * Priority order for choosing the primary label when a model ranks well
 * in multiple categories. Earlier = higher priority.
 */
const LABEL_PRIORITY: (keyof DerivedScores)[] = [
  "image",
  "coding",
  "research",
  "fast",
  "value",
  "recommended",
];

// -- Types --------------------------------------------------------------------

export interface ModelRanks {
  /** Rank per category (1-based). Absent if model has no score in that category. */
  recommended?: number;
  coding?: number;
  research?: number;
  fast?: number;
  value?: number;
  image?: number;
}

// -- Rank computation (batch) -------------------------------------------------

/**
 * Given an array of { id, scores } for all scored models, compute per-category
 * ranks. Returns a Map from model id → ModelRanks.
 *
 * Ties get the same rank (standard competition ranking: 1,1,3,4,...).
 */
export function computeAllRanks(
  models: { id: string; scores: DerivedScores }[],
): Map<string, ModelRanks> {
  const categories: (keyof DerivedScores)[] = [
    "recommended",
    "coding",
    "research",
    "fast",
    "value",
    "image",
  ];

  const ranksMap = new Map<string, ModelRanks>();

  // Initialize empty ranks for every model
  for (const m of models) {
    ranksMap.set(m.id, {});
  }

  for (const cat of categories) {
    // Filter to models that have a score in this category
    const scored = models
      .filter((m) => m.scores[cat] !== undefined && m.scores[cat]! > 0)
      .map((m) => ({ id: m.id, score: m.scores[cat]! }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Assign competition ranks (ties get same rank)
    let currentRank = 1;
    for (let i = 0; i < scored.length; i++) {
      if (i > 0 && scored[i].score < scored[i - 1].score) {
        currentRank = i + 1;
      }
      const ranks = ranksMap.get(scored[i].id);
      if (ranks) {
        ranks[cat] = currentRank;
      }
    }
  }

  return ranksMap;
}

// -- Label derivation (per-model, requires ranks) ----------------------------

/**
 * Build a semantic label key from rank and category.
 *   rank 1 → "{category}.best"  (e.g. "coding.best")
 *   rank 2-TOP_N → "{category}.top"  (e.g. "fast.top")
 */
function labelKey(rank: number, category: string): string {
  return `${category}.${rank === 1 ? "best" : "top"}`;
}

/**
 * Derive labels from ranks. Only models ranked within TOP_N in at least one
 * category get labels. Returns up to 2 labels and a primary label.
 */
export function deriveLabels(
  _scores: DerivedScores,
  ranks?: ModelRanks,
): {
  labels: string[];
  primaryLabel?: string;
} {
  if (!ranks) {
    return { labels: [], primaryLabel: undefined };
  }

  // Collect categories where this model is in the top N
  const topCategories: { key: keyof DerivedScores; rank: number }[] = [];
  for (const cat of LABEL_PRIORITY) {
    const rank = ranks[cat];
    if (rank !== undefined && rank <= TOP_N) {
      topCategories.push({ key: cat, rank });
    }
  }

  if (topCategories.length === 0) {
    return { labels: [], primaryLabel: undefined };
  }

  // Sort by rank (best first), then by priority order for ties
  topCategories.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return LABEL_PRIORITY.indexOf(a.key) - LABEL_PRIORITY.indexOf(b.key);
  });

  // Take up to 2 labels
  const labels = topCategories
    .slice(0, 2)
    .map((c) => labelKey(c.rank, c.key));

  // Primary label: highest priority category that's in top N
  const primaryCategory = topCategories[0];
  const primaryLabel = labelKey(primaryCategory.rank, primaryCategory.key);

  return { labels, primaryLabel };
}

/**
 * Determine supported intents from scores.
 */
export function deriveSupportedIntents(scores: DerivedScores): string[] {
  const intents: string[] = [];
  if (scores.recommended !== undefined) intents.push("recommended");
  if (scores.coding !== undefined) intents.push("coding");
  if (scores.research !== undefined) intents.push("research");
  if (scores.fast !== undefined) intents.push("fast");
  if (scores.value !== undefined) intents.push("value");
  if (scores.image !== undefined) intents.push("image");
  return intents;
}
