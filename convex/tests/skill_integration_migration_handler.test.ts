import assert from "node:assert/strict";
import test from "node:test";

import { migrateSkillIntegrationOverrides } from "../models/migrations";

test("migrateSkillIntegrationOverrides converts legacy fields and clears them even when chat legacy arrays are empty", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: (table: string) => ({
        collect: async () => {
          if (table === "personas") {
            return [{
              _id: "persona_1",
              discoverableSkillIds: ["skill_1"],
              enabledIntegrations: ["gmail"],
            }];
          }
          if (table === "chats") {
            return [{
              _id: "chat_1",
              disabledSkillIds: [],
            }];
          }
          return [];
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  const result = await (migrateSkillIntegrationOverrides as any)._handler(ctx, {});

  assert.deepEqual(result, {
    personasSkillOverrides: 1,
    personasIntegrationOverrides: 1,
    chatsSkillOverrides: 0,
    chatsIntegrationOverrides: 0,
    personasLegacyCleared: 1,
    chatsLegacyCleared: 1,
  });

  assert.deepEqual(patches, [
    {
      id: "persona_1",
      patch: {
        skillOverrides: [{ skillId: "skill_1", state: "available" }],
      },
    },
    {
      id: "persona_1",
      patch: {
        integrationOverrides: [{ integrationId: "gmail", enabled: true }],
      },
    },
    {
      id: "persona_1",
      patch: {
        discoverableSkillIds: undefined,
        enabledIntegrations: undefined,
      },
    },
    {
      id: "chat_1",
      patch: {
        discoverableSkillIds: undefined,
        disabledSkillIds: undefined,
      },
    },
  ]);
});

test("migrateSkillIntegrationOverrides dry-run counts chat merges without patching existing overrides", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: (table: string) => ({
        collect: async () => {
          if (table === "personas") {
            return [
              {
                _id: "persona_existing",
                discoverableSkillIds: ["skill_1"],
                enabledIntegrations: ["gmail"],
                skillOverrides: [{ skillId: "skill_keep", state: "always" }],
                integrationOverrides: [{ integrationId: "drive", enabled: true }],
              },
              {
                _id: "persona_empty",
                discoverableSkillIds: [],
                enabledIntegrations: [],
              },
            ];
          }
          if (table === "chats") {
            return [
              {
                _id: "chat_merge",
                discoverableSkillIds: ["skill_a", "skill_b"],
                disabledSkillIds: ["skill_b", "skill_c"],
              },
              {
                _id: "chat_existing",
                discoverableSkillIds: ["skill_d"],
                disabledSkillIds: ["skill_e"],
                skillOverrides: [{ skillId: "skill_keep", state: "available" }],
              },
            ];
          }
          return [];
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  const result = await (migrateSkillIntegrationOverrides as any)._handler(ctx, { dryRun: true });

  assert.deepEqual(result, {
    personasSkillOverrides: 0,
    personasIntegrationOverrides: 0,
    chatsSkillOverrides: 1,
    chatsIntegrationOverrides: 0,
    personasLegacyCleared: 2,
    chatsLegacyCleared: 2,
  });
  assert.deepEqual(patches, []);
});
