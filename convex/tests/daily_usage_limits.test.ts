import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";

import {
  DAILY_USAGE_LIMITS,
  dailyUsageAmount,
  pruneDailyUsage,
  tryConsumeDailyUsage,
  utcDay,
} from "../lib/daily_usage";
import { computeUserEmbedding, PLATFORM_EMBEDDING_DAILY_LIMIT_CODE } from "../memory/embedding_helpers";
import {
  assertImportedMemoriesWithinLimits,
  MAX_IMPORTED_MEMORIES_PER_COMMIT,
  MAX_IMPORTED_MEMORY_CHARS,
} from "../memory/operations_import_commit_handlers";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 16, 12);

test("daily counters accumulate per user and kind and refuse the call that would exceed the limit", async () => {
  const rows: Record<string, any[]> = { userDailyUsage: [] };
  const ctx = createStatefulMockCtx(rows) as any;
  const limit = DAILY_USAGE_LIMITS.platform_embeddings;
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "platform_embeddings", limit - 1, NOW), true);
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "platform_embeddings", 1, NOW), true);
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "platform_embeddings", 1, NOW), false);
  assert.equal(await dailyUsageAmount(ctx, "user_1", "platform_embeddings", NOW), limit);
  // Other users, other kinds and the next UTC day have their own counters.
  assert.equal(await tryConsumeDailyUsage(ctx, "user_2", "platform_embeddings", 1, NOW), true);
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "upload_bytes", 10, NOW), true);
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "platform_embeddings", 1, NOW + DAY_MS), true);
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "upload_bytes", -1, NOW), false);
  assert.equal(await tryConsumeDailyUsage(ctx, "user_1", "upload_bytes", Number.NaN, NOW), false);
});

test("pruning removes only counters older than the retention window", async () => {
  const rows: Record<string, any[]> = {
    userDailyUsage: [
      { _id: "old", day: utcDay(NOW - 5 * DAY_MS) },
      { _id: "yesterday", day: utcDay(NOW - DAY_MS) },
      { _id: "today", day: utcDay(NOW) },
    ],
  };
  assert.equal(await pruneDailyUsage(createStatefulMockCtx(rows) as any, NOW, 10), 1);
  assert.deepEqual(rows.userDailyUsage.map((row) => row._id), ["yesterday", "today"]);
});

test("platform-key embeddings stop at the daily allowance; OpenRouter keys are not metered", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "platform-test-key";
  const reservations: string[] = [];
  try {
    const ctx = {
      runQuery: async () => null,
      runMutation: async (ref: unknown, args: { userId: string }) => {
        reservations.push(`${getFunctionName(ref as never)}:${args.userId}`);
        return false;
      },
    } as any;
    await assert.rejects(
      computeUserEmbedding(ctx, "user_1", "remember this"),
      (error: unknown) => error instanceof ConvexError
        && (error.data as { code?: string }).code === PLATFORM_EMBEDDING_DAILY_LIMIT_CODE,
    );
    assert.deepEqual(reservations, ["memory/embedding_budget:reservePlatformEmbedding:user_1"]);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
  }
});

test("memory imports are bounded in item count and item length", () => {
  const item = (content: string) => ({ content });
  assert.doesNotThrow(() => assertImportedMemoriesWithinLimits(
    Array.from({ length: MAX_IMPORTED_MEMORIES_PER_COMMIT }, () => item("fact")),
  ));
  assert.doesNotThrow(() => assertImportedMemoriesWithinLimits([item(`  ${"x".repeat(MAX_IMPORTED_MEMORY_CHARS)}  `)]));
  const isValidation = (error: unknown) =>
    error instanceof ConvexError && (error.data as { code?: string }).code === "VALIDATION";
  assert.throws(() => assertImportedMemoriesWithinLimits(
    Array.from({ length: MAX_IMPORTED_MEMORIES_PER_COMMIT + 1 }, () => item("fact")),
  ), isValidation);
  assert.throws(() => assertImportedMemoriesWithinLimits([item("x".repeat(MAX_IMPORTED_MEMORY_CHARS + 1))]), isValidation);
});
