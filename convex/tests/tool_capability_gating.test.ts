import assert from "node:assert/strict";
import test from "node:test";

import {
  assertToolCapableModelIds,
  filterToolIncompatibleOptions,
  filterParticipantToolOptions,
} from "../lib/tool_capability";
import { createPersonaInternal } from "../personas/mutations";
import { createJobInternal, updateJob } from "../scheduledJobs/mutations";

function buildCtx(models: Record<string, { supportsTools?: boolean } | null>) {
  return {
    db: {
      query: (table: string) => {
        assert.equal(table, "cachedModels");
        return {
          withIndex: (_index: string, apply: (query: any) => any) => {
            let selectedModelId = "";
            apply({
              eq: (_field: string, modelId: string) => {
                selectedModelId = modelId;
                return {};
              },
            });
            return {
              first: async () => models[selectedModelId] ?? null,
            };
          },
        };
      },
    },
  } as any;
}

// ── filterToolIncompatibleOptions (new silent-downgrade API) ────────────

test("filterToolIncompatibleOptions strips integrations for non-tool model", async () => {
  const ctx = buildCtx({
    "openai/gpt-5": { supportsTools: false },
  });

  const result = await filterToolIncompatibleOptions(ctx, {
    enabledIntegrations: ["gmail"],
    modelIds: ["openai/gpt-5"],
  });

  assert.deepEqual(result.enabledIntegrations, []);
  assert.deepEqual(result.strippedModelIds, ["openai/gpt-5"]);
  assert.equal(result.requireToolUse, false);
});

test("filterToolIncompatibleOptions passes through for tool-capable model", async () => {
  const ctx = buildCtx({
    "openai/gpt-5": { supportsTools: true },
  });

  const result = await filterToolIncompatibleOptions(ctx, {
    enabledIntegrations: ["notion"],
    modelIds: ["openai/gpt-5"],
  });

  assert.deepEqual(result.enabledIntegrations, ["notion"]);
  assert.deepEqual(result.strippedModelIds, []);
  assert.equal(result.requireToolUse, false);
});

test("filterToolIncompatibleOptions strips requireToolUse for non-tool model", async () => {
  const ctx = buildCtx({
    "openai/gpt-5": { supportsTools: false },
  });

  const result = await filterToolIncompatibleOptions(ctx, {
    enabledIntegrations: [],
    modelIds: ["openai/gpt-5"],
    requireToolUse: true,
  });

  assert.deepEqual(result.enabledIntegrations, []);
  assert.deepEqual(result.strippedModelIds, ["openai/gpt-5"]);
  assert.equal(result.requireToolUse, false);
});

test("filterToolIncompatibleOptions is a no-op when no integrations or tool requirement", async () => {
  const ctx = buildCtx({
    "openai/gpt-5": { supportsTools: false },
  });

  const result = await filterToolIncompatibleOptions(ctx, {
    enabledIntegrations: [],
    modelIds: ["openai/gpt-5"],
  });

  // Fast path — no stripping needed because nothing tool-dependent was requested
  assert.deepEqual(result.enabledIntegrations, []);
  assert.deepEqual(result.strippedModelIds, []);
  assert.equal(result.requireToolUse, false);
});

// ── filterParticipantToolOptions ───────────────────────────────────────

test("filterParticipantToolOptions strips integrations when any participant lacks tools", async () => {
  const ctx = buildCtx({
    "openai/gpt-5": { supportsTools: true },
    "google/gemini": { supportsTools: false },
  });

  const result = await filterParticipantToolOptions(ctx, {
    enabledIntegrations: ["drive"],
    participants: [
      { modelId: "openai/gpt-5" },
      { modelId: "google/gemini" },
    ] as any,
  });

  assert.deepEqual(result.enabledIntegrations, []);
  assert.ok(result.strippedModelIds.includes("google/gemini"));
});

// ── Legacy assert (deprecated, kept for backward compat) ───────────────

test("deprecated assertToolCapableModelIds still throws for non-tool model", async () => {
  const ctx = buildCtx({
    "openai/gpt-5": { supportsTools: false },
  });

  await assert.rejects(
    assertToolCapableModelIds(ctx, {
      enabledIntegrations: ["gmail"],
      modelIds: ["openai/gpt-5"],
    }),
    /tool use/i,
  );
});

// ── createPersonaInternal silent downgrade ──────────────────────────────

test("createPersonaInternal creates persona without integration fields (M30 migration pending)", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      ...buildCtx({
        "openai/gpt-5": { supportsTools: false },
      }).db,
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "persona_1";
      },
    },
  } as any;

  await (createPersonaInternal as any)._handler(ctx, {
    userId: "user_1",
    displayName: "Tool User",
    systemPrompt: "Use Gmail",
    modelId: "openai/gpt-5",
    enabledIntegrations: ["gmail"],
  });

  // M30: createPersonaInternal still uses legacy args but doesn't write integration fields
  // (integrationOverrides should be handled by setPersonaIntegrationOverrides post-creation)
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "personas");
  assert.deepEqual(inserts[0].value.enabledIntegrations, undefined);
});

// ── createJobInternal silent downgrade ──────────────────────────────────

test("createJobInternal strips integrations for non-tool model", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      ...buildCtx({
        "openai/gpt-5": { supportsTools: false },
      }).db,
      get: async () => null,
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "job_1";
      },
      patch: async () => undefined,
    },
    scheduler: {
      runAt: async () => "scheduled_1",
    },
  } as any;

  await (createJobInternal as any)._handler(ctx, {
    userId: "user_1",
    name: "Inbox summary",
    prompt: "Summarize inbox",
    modelId: "openai/gpt-5",
    recurrence: { type: "manual" },
    enabledIntegrations: ["gmail"],
  });

  // Job integrations are silently stripped for non-tool-capable models
  const jobInsert = inserts.find((i) => i.table === "scheduledJobs");
  assert.ok(jobInsert, "scheduledJobs insert should exist");
  assert.deepEqual(jobInsert.value.enabledIntegrations, []);
});

// ── updateJob tests ────────────────────────────────────────────────────

test("updateJob clears persona when personaId is explicitly null", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const job = {
    _id: "job_1",
    userId: "user_1",
    name: "Morning summary",
    prompt: "Prompt",
    modelId: "openai/gpt-5",
    personaId: "persona_1",
    enabledIntegrations: ["gmail"],
    recurrence: { type: "manual" },
    status: "active",
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "job_1") return job;
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1", status: "active" }),
            }),
          };
        }
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1" }),
            }),
          };
        }
        if (table === "cachedModels") {
          return {
            withIndex: (_index: string, apply: (query: any) => any) => {
              let selectedModelId = "";
              apply({
                eq: (_field: string, modelId: string) => {
                  selectedModelId = modelId;
                  return {};
                },
              });
              return {
                first: async () => (selectedModelId === "openai/gpt-5" ? { supportsTools: true } : null),
              };
            },
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  } as any;

  await (updateJob as any)._handler(ctx, {
    jobId: "job_1",
    personaId: null,
    modelId: "openai/gpt-5",
    enabledIntegrations: ["gmail"],
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "job_1");
  assert.equal(patches[0].value.personaId, undefined);
});

test("updateJob silently strips integrations when persona model lacks tools", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const job = {
    _id: "job_1",
    userId: "user_1",
    name: "Morning summary",
    prompt: "Prompt",
    modelId: "openai/gpt-5",
    personaId: "persona_1",
    enabledIntegrations: ["gmail"],
    recurrence: { type: "manual" },
    status: "active",
  };
  const persona = {
    _id: "persona_1",
    userId: "user_1",
    modelId: "google/gemini",
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "job_1") return job;
        if (id === "persona_1") return persona;
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1", status: "active" }),
            }),
          };
        }
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1" }),
            }),
          };
        }
        if (table === "cachedModels") {
          return {
            withIndex: (_index: string, apply: (query: any) => any) => {
              let selectedModelId = "";
              apply({
                eq: (_field: string, modelId: string) => {
                  selectedModelId = modelId;
                  return {};
                },
              });
              return {
                first: async () =>
                  selectedModelId === "google/gemini"
                    ? { supportsTools: false }
                    : { supportsTools: true },
              };
            },
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  } as any;

  // Should succeed (not throw) — integrations silently stripped
  await (updateJob as any)._handler(ctx, {
    jobId: "job_1",
    name: "Renamed",
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "job_1");
  // Integrations should be stripped because persona model (google/gemini) lacks tools
  assert.deepEqual(patches[0].value.enabledIntegrations, []);
  assert.equal(patches[0].value.name, "Renamed");
});
