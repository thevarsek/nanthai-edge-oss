import { z } from "zod";

const nullableCount = z.number().int().nonnegative().nullable();
export const UsageObservationSchema = z.strictObject({
  occurredAtMs: z.number().int().nonnegative(),
  provider: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
  tokens: z.strictObject({
    input: nullableCount,
    output: nullableCount,
    cachedInput: nullableCount,
    reasoning: nullableCount,
    total: nullableCount,
  }),
  cost: z.discriminatedUnion("source", [
    z.strictObject({
      source: z.literal("provider_reported"),
      amount: z.number().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    }),
    z.strictObject({
      source: z.literal("api_equivalent_estimate"),
      amount: z.number().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      pricingVersion: z.string().min(1).nullable(),
    }),
    z.strictObject({
      source: z.literal("unpriced"),
      reason: z.string().min(1),
    }),
  ]),
});
const TokenAggregateSchema = z.strictObject({
  known: z.number().int().nonnegative(),
  unavailableReports: z.number().int().nonnegative(),
});
const CostAggregateSchema = z.strictObject({
  source: z.enum(["provider_reported", "api_equivalent_estimate"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  pricingVersion: z.string().min(1).nullable(),
  amount: z.number().nonnegative(),
});
export const MonthlyUsageSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  provider: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
  turnReports: z.number().int().positive(),
  tokens: z.strictObject({
    input: TokenAggregateSchema,
    output: TokenAggregateSchema,
    cachedInput: TokenAggregateSchema,
    reasoning: TokenAggregateSchema,
    total: TokenAggregateSchema,
  }),
  costs: z.array(CostAggregateSchema),
  unpricedReports: z.number().int().nonnegative(),
});
export const UsageFileSchema = z.strictObject({
  version: z.literal(1),
  months: z.array(MonthlyUsageSchema),
});

export type UsageObservation = z.infer<typeof UsageObservationSchema>;
export type MonthlyUsage = z.infer<typeof MonthlyUsageSchema>;

export function createMonth(month: string, value: UsageObservation): MonthlyUsage {
  return {
    month,
    provider: value.provider,
    modelId: value.modelId,
    turnReports: 1,
    tokens: mapTokens(value.tokens, (count) => ({
      known: count ?? 0,
      unavailableReports: count === null ? 1 : 0,
    })),
    costs: costBucket(value),
    unpricedReports: value.cost.source === "unpriced" ? 1 : 0,
  };
}

export function addObservation(month: MonthlyUsage, value: UsageObservation): MonthlyUsage {
  const costs = [...month.costs];
  if (value.cost.source !== "unpriced") {
    const pricingVersion = value.cost.source === "api_equivalent_estimate"
      ? value.cost.pricingVersion : null;
    const existing = costs.find((cost) => cost.source === value.cost.source
      && cost.currency === value.cost.currency && cost.pricingVersion === pricingVersion);
    if (existing === undefined) {
      costs.push({
        source: value.cost.source,
        currency: value.cost.currency,
        pricingVersion,
        amount: value.cost.amount,
      });
    } else existing.amount += value.cost.amount;
  }
  return {
    ...month,
    turnReports: month.turnReports + 1,
    tokens: mapTokens(value.tokens, (count, key) => ({
      known: month.tokens[key].known + (count ?? 0),
      unavailableReports: month.tokens[key].unavailableReports + (count === null ? 1 : 0),
    })),
    costs,
    unpricedReports: month.unpricedReports + (value.cost.source === "unpriced" ? 1 : 0),
  };
}

function costBucket(value: UsageObservation): MonthlyUsage["costs"] {
  if (value.cost.source === "unpriced") return [];
  return [{
    source: value.cost.source,
    currency: value.cost.currency,
    pricingVersion: value.cost.source === "api_equivalent_estimate"
      ? value.cost.pricingVersion : null,
    amount: value.cost.amount,
  }];
}

type TokenCounts = UsageObservation["tokens"];
type TokenKey = keyof TokenCounts;

function mapTokens<T>(
  tokens: TokenCounts,
  map: (count: number | null, key: TokenKey) => T,
): Record<TokenKey, T> {
  return {
    input: map(tokens.input, "input"),
    output: map(tokens.output, "output"),
    cachedInput: map(tokens.cachedInput, "cachedInput"),
    reasoning: map(tokens.reasoning, "reasoning"),
    total: map(tokens.total, "total"),
  };
}

/** Merge transport pages, retaining the server's month/model and price buckets. */
export function mergeMonthlyUsage(pages: readonly MonthlyUsage[]): MonthlyUsage[] {
  const groups = new Map<string, MonthlyUsage>();
  for (const incoming of pages) {
    const key = JSON.stringify([incoming.month, incoming.provider, incoming.modelId]);
    const previous = groups.get(key);
    if (!previous) { groups.set(key, MonthlyUsageSchema.parse(incoming)); continue; }
    previous.turnReports += incoming.turnReports;
    previous.unpricedReports += incoming.unpricedReports;
    for (const token of Object.keys(previous.tokens) as TokenKey[]) {
      previous.tokens[token].known += incoming.tokens[token].known;
      previous.tokens[token].unavailableReports += incoming.tokens[token].unavailableReports;
    }
    for (const cost of incoming.costs) {
      const bucket = previous.costs.find(value => value.source === cost.source
        && value.currency === cost.currency && value.pricingVersion === cost.pricingVersion);
      if (bucket) bucket.amount += cost.amount;
      else previous.costs.push({ ...cost });
    }
  }
  return [...groups.values()].sort((left, right) => right.month.localeCompare(left.month));
}
