import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  getOptionalUserOpenRouterApiKey,
  getRequiredUserOpenRouterApiKey,
} from "../lib/user_secrets";
import { assertRateLimit } from "../lib/rate_limit";

test("user secret helpers return the optional key and reject missing required keys", async () => {
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) =>
      args.userId === "user_1" ? "sk-openrouter" : "   ",
  } as any;

  assert.equal(await getOptionalUserOpenRouterApiKey(ctx, "user_1"), "sk-openrouter");
  assert.equal(await getOptionalUserOpenRouterApiKey(ctx, "user_2"), "   ");
  await assert.rejects(
    () => getRequiredUserOpenRouterApiKey(ctx, "user_2"),
    (error: unknown) =>
      error instanceof ConvexError &&
      String(error.data?.code) === "MISSING_API_KEY",
  );
});

test("assertRateLimit allows normal traffic and throws ConvexError when the window is exceeded", async () => {
  const underLimitCtx = {
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => new Array(30).fill({}),
        }),
      }),
    },
  } as any;
  const overLimitCtx = {
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => new Array(31).fill({}),
        }),
      }),
    },
  } as any;

  await assert.doesNotReject(() => assertRateLimit(underLimitCtx, "user_1"));
  await assert.rejects(
    () => assertRateLimit(overLimitCtx, "user_1"),
    (error: unknown) =>
      error instanceof ConvexError &&
      String(error.data?.code) === "RATE_LIMIT",
  );
});
