import assert from "node:assert/strict";
import test from "node:test";

import {
  setSkillDefault,
  removeSkillDefault,
  setIntegrationDefault,
  removeIntegrationDefault,
} from "../preferences/mutations";

// =============================================================================
// Helpers
// =============================================================================

function buildAuth(userId: string = "user_1") {
  return {
    getUserIdentity: async () => ({ subject: userId, email: "u@test.com" }),
  };
}

/** Minimal mock ctx that tracks patches/inserts against a single prefs row. */
function buildCtx(
  existingPrefs: Record<string, unknown> | null,
  userId = "user_1",
  options: {
    skill?: Record<string, unknown>;
    models?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  let currentPrefs = existingPrefs ? { ...existingPrefs } : null;

  return {
    patches,
    inserts,
    get currentPrefs() { return currentPrefs; },
    ctx: {
      auth: buildAuth(userId),
      db: {
        get: async () => options.skill ?? null,
        query: (table: string) => ({
          withIndex: (
            _index: string,
            apply?: (query: { eq: (field: string, value: string) => unknown }) => unknown,
          ) => {
            let selected = "";
            const query = {
              eq: (_field: string, value: string) => {
                selected = value;
                return query;
              },
            };
            apply?.(query);
            return {
              first: async () => {
                if (table === "userPreferences") return currentPrefs;
                if (table === "purchaseEntitlements") {
                  return { _id: "ent_1", userId, status: "active" };
                }
                if (table === "cachedModels") {
                  return options.models?.[selected] ?? null;
                }
                return null;
              },
              filter: () => ({
                first: async () => ({ _id: "ent_1", userId, status: "active" }),
              }),
            };
          },
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
          if (currentPrefs && (currentPrefs as any)._id === id) {
            currentPrefs = { ...currentPrefs, ...patch };
          }
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          const newId = `${table}_new`;
          currentPrefs = { _id: newId, ...value };
          return newId;
        },
      },
    },
  };
}

function makePrefs(overrides: Record<string, unknown> = {}) {
  return {
    _id: "prefs_1",
    userId: "user_1",
    skillDefaults: undefined,
    integrationDefaults: undefined,
    updatedAt: 1000,
    ...overrides,
  };
}

// =============================================================================
// MARK: setSkillDefault
// =============================================================================

test("setSkillDefault: creates prefs if missing", async () => {
  const { ctx, inserts } = buildCtx(null);
  await (setSkillDefault as any)._handler(ctx, {
    skillId: "skill_1",
    state: "always",
  });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "userPreferences");
  const sd = inserts[0].value.skillDefaults as any[];
  assert.equal(sd.length, 1);
  assert.equal(sd[0].skillId, "skill_1");
  assert.equal(sd[0].state, "always");
});

test("setSkillDefault: upserts into empty skillDefaults", async () => {
  const { ctx, patches } = buildCtx(makePrefs());
  await (setSkillDefault as any)._handler(ctx, {
    skillId: "skill_1",
    state: "available",
  });
  assert.equal(patches.length, 1);
  const sd = patches[0].patch.skillDefaults as any[];
  assert.equal(sd.length, 1);
  assert.equal(sd[0].state, "available");
});

test("setSkillDefault: updates existing entry", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    skillDefaults: [{ skillId: "skill_1", state: "available" }],
  }));
  await (setSkillDefault as any)._handler(ctx, {
    skillId: "skill_1",
    state: "always",
  });
  const sd = patches[0].patch.skillDefaults as any[];
  assert.equal(sd.length, 1);
  assert.equal(sd[0].state, "always");
});

test("setSkillDefault: preserves other entries when upserting", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    skillDefaults: [
      { skillId: "skill_1", state: "available" },
      { skillId: "skill_2", state: "never" },
    ],
  }));
  await (setSkillDefault as any)._handler(ctx, {
    skillId: "skill_1",
    state: "always",
  });
  const sd = patches[0].patch.skillDefaults as any[];
  assert.equal(sd.length, 2);
  const s1 = sd.find((e: any) => e.skillId === "skill_1");
  const s2 = sd.find((e: any) => e.skillId === "skill_2");
  assert.equal(s1.state, "always");
  assert.equal(s2.state, "never");
});

test("setSkillDefault: reports an unavailable selected model without implying ZDR", async () => {
  const { ctx } = buildCtx(
    makePrefs({
      zdrEnabled: false,
      defaultImageGenerationModelId: "image/retired",
    }),
    "user_1",
    {
      skill: {
        name: "Image Generation",
        requiredToolProfiles: ["imageGeneration"],
      },
    },
  );

  await assert.rejects(
    (setSkillDefault as any)._handler(ctx, {
      skillId: "image_skill",
      state: "available",
    }),
    (error: unknown) => error instanceof Error &&
      "data" in error &&
      (error.data as { code?: string }).code === "MODEL_UNAVAILABLE" &&
      !error.message.includes("ZDR"),
  );
});

test("setSkillDefault: preserves the ZDR-specific error for incompatible models", async () => {
  const modelId = "image/non-zdr";
  const { ctx } = buildCtx(
    makePrefs({
      zdrEnabled: true,
      defaultImageGenerationModelId: modelId,
    }),
    "user_1",
    {
      skill: {
        name: "Image Generation",
        requiredToolProfiles: ["imageGeneration"],
      },
      models: {
        [modelId]: {
          modelId,
          supportsImages: true,
          imageCapabilities: { isAvailable: true },
          hasZdrEndpoint: false,
        },
      },
    },
  );

  await assert.rejects(
    (setSkillDefault as any)._handler(ctx, {
      skillId: "image_skill",
      state: "always",
    }),
    (error: unknown) => error instanceof Error &&
      "data" in error &&
      (error.data as { code?: string }).code === "ZDR_MODEL_UNAVAILABLE" &&
      error.message.includes("ZDR-compatible"),
  );
});

// =============================================================================
// MARK: removeSkillDefault
// =============================================================================

test("removeSkillDefault: no-op when prefs missing", async () => {
  const { ctx, patches } = buildCtx(null);
  await (removeSkillDefault as any)._handler(ctx, { skillId: "skill_1" });
  assert.equal(patches.length, 0);
});

test("removeSkillDefault: no-op when skillDefaults undefined", async () => {
  const { ctx, patches } = buildCtx(makePrefs());
  await (removeSkillDefault as any)._handler(ctx, { skillId: "skill_1" });
  assert.equal(patches.length, 0);
});

test("removeSkillDefault: removes entry, clears array if empty", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    skillDefaults: [{ skillId: "skill_1", state: "always" }],
  }));
  await (removeSkillDefault as any)._handler(ctx, { skillId: "skill_1" });
  assert.equal(patches[0].patch.skillDefaults, undefined);
});

test("removeSkillDefault: preserves other entries", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    skillDefaults: [
      { skillId: "skill_1", state: "always" },
      { skillId: "skill_2", state: "never" },
    ],
  }));
  await (removeSkillDefault as any)._handler(ctx, { skillId: "skill_1" });
  const sd = patches[0].patch.skillDefaults as any[];
  assert.equal(sd.length, 1);
  assert.equal(sd[0].skillId, "skill_2");
});

// =============================================================================
// MARK: setIntegrationDefault
// =============================================================================

test("setIntegrationDefault: creates prefs if missing", async () => {
  const { ctx, inserts } = buildCtx(null);
  await (setIntegrationDefault as any)._handler(ctx, {
    integrationId: "google_gmail",
    enabled: true,
  });
  assert.equal(inserts.length, 1);
  const id = inserts[0].value.integrationDefaults as any[];
  assert.equal(id.length, 1);
  assert.equal(id[0].integrationId, "google_gmail");
  assert.equal(id[0].enabled, true);
});

test("setIntegrationDefault: upserts into existing array", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    integrationDefaults: [{ integrationId: "notion", enabled: true }],
  }));
  await (setIntegrationDefault as any)._handler(ctx, {
    integrationId: "google_gmail",
    enabled: false,
  });
  const id = patches[0].patch.integrationDefaults as any[];
  assert.equal(id.length, 2);
});

test("setIntegrationDefault: updates existing entry", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    integrationDefaults: [{ integrationId: "gmail", enabled: true }],
  }));
  await (setIntegrationDefault as any)._handler(ctx, {
    integrationId: "gmail",
    enabled: false,
  });
  const id = patches[0].patch.integrationDefaults as any[];
  assert.equal(id.length, 1);
  assert.equal(id[0].enabled, false);
});

// =============================================================================
// MARK: removeIntegrationDefault
// =============================================================================

test("removeIntegrationDefault: no-op when prefs missing", async () => {
  const { ctx, patches } = buildCtx(null);
  await (removeIntegrationDefault as any)._handler(ctx, { integrationId: "gmail" });
  assert.equal(patches.length, 0);
});

test("removeIntegrationDefault: removes entry, clears array if empty", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    integrationDefaults: [{ integrationId: "gmail", enabled: true }],
  }));
  await (removeIntegrationDefault as any)._handler(ctx, { integrationId: "gmail" });
  assert.equal(patches[0].patch.integrationDefaults, undefined);
});

test("removeIntegrationDefault: preserves other entries", async () => {
  const { ctx, patches } = buildCtx(makePrefs({
    integrationDefaults: [
      { integrationId: "gmail", enabled: true },
      { integrationId: "notion", enabled: false },
    ],
  }));
  await (removeIntegrationDefault as any)._handler(ctx, { integrationId: "gmail" });
  const id = patches[0].patch.integrationDefaults as any[];
  assert.equal(id.length, 1);
  assert.equal(id[0].integrationId, "notion");
});
