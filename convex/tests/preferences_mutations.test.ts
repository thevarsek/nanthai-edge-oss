import assert from "node:assert/strict";
import test from "node:test";

import { upsertPreferences } from "../preferences/mutations";
import { ConvexError } from "convex/values";

function createCtx(existing: Record<string, unknown> | null) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  return {
    patches,
    inserts,
    ctx: {
      auth: {
        getUserIdentity: async () => ({ subject: "user_1" }),
      },
      db: {
        query: () => ({
          withIndex: (_name: string, build: (q: { eq: () => unknown }) => unknown) => {
            build({ eq: () => null });
            return {
              first: async () => existing,
            };
          },
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          return "prefs_new";
        },
      },
    } as any,
  };
}

test("upsertPreferences clears title and memory model overrides when ZDR is enabled", async () => {
  const existing = {
    _id: "prefs_1",
    userId: "user_1",
    preferenceWriteEpoch: 3,
    titleModelId: "openai/custom-title",
    memoryExtractionModelId: "openai/custom-memory",
  };
  const existingState = createCtx(existing);

  await (upsertPreferences as any)._handler(existingState.ctx, {
    expectedPreferenceWriteEpoch: 3,
    zdrEnabled: true,
    titleModelId: "openai/new-title",
    memoryExtractionModelId: "openai/new-memory",
  });

  assert.equal(existingState.patches.length, 1);
  assert.equal(existingState.patches[0]?.id, "prefs_1");
  assert.equal(existingState.patches[0]?.patch.zdrEnabled, true);
  assert.equal(existingState.patches[0]?.patch.titleModelId, undefined);
  assert.equal(existingState.patches[0]?.patch.memoryExtractionModelId, undefined);

  const insertState = createCtx(null);
  await (upsertPreferences as any)._handler(insertState.ctx, {
    zdrEnabled: true,
    titleModelId: "openai/new-title",
    memoryExtractionModelId: "openai/new-memory",
  });

  assert.equal(insertState.inserts.length, 1);
  assert.equal(insertState.inserts[0]?.value.zdrEnabled, true);
  assert.equal(insertState.inserts[0]?.value.titleModelId, undefined);
  assert.equal(insertState.inserts[0]?.value.memoryExtractionModelId, undefined);
});

test("upsertPreferences normalizes, stores, and clears image defaults", async () => {
  const state = createCtx({ _id: "prefs_1", userId: "user_1" });
  await (upsertPreferences as any)._handler(state.ctx, {
    defaultImageCount: 3.0,
    defaultImageAspectRatio: " 16:9 ",
    defaultImageResolution: " 2K ",
    defaultImageQuality: " HIGH ",
    defaultImageBackground: "Transparent",
    defaultImageOutputFormat: "WEBP",
    defaultImageOutputCompression: 0.0,
  });

  assert.deepEqual(state.patches[0]?.patch, {
    updatedAt: state.patches[0]?.patch.updatedAt,
    defaultImageCount: 3,
    defaultImageAspectRatio: "16:9",
    defaultImageResolution: "2K",
    defaultImageQuality: "high",
    defaultImageBackground: "transparent",
    defaultImageOutputFormat: "webp",
    defaultImageOutputCompression: 0,
  });

  const clearState = createCtx({ _id: "prefs_1", userId: "user_1" });
  await (upsertPreferences as any)._handler(clearState.ctx, {
    defaultImageCount: null,
    defaultImageOutputCompression: null,
  });
  assert.equal(clearState.patches[0]?.patch.defaultImageCount, undefined);
  assert.equal(clearState.patches[0]?.patch.defaultImageOutputCompression, undefined);
});

test("upsertPreferences rejects impossible image defaults", async () => {
  for (const args of [
    { defaultImageCount: 1.5 },
    { defaultImageOutputCompression: 101 },
    { defaultImageQuality: "ultra" },
    { defaultImageAspectRatio: "   " },
  ]) {
    const state = createCtx({ _id: "prefs_1", userId: "user_1" });
    await assert.rejects(
      (upsertPreferences as any)._handler(state.ctx, args),
      (error: unknown) =>
        error instanceof ConvexError && error.data?.code === "VALIDATION_ERROR",
    );
    assert.equal(state.patches.length, 0);
  }
});
