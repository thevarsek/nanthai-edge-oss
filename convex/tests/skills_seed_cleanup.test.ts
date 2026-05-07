import assert from "node:assert/strict";
import test from "node:test";

import { deleteRemovedSystemSkills } from "../skills/mutations_seed";

const deleteRemovedSystemSkillsHandler = (
  deleteRemovedSystemSkills as unknown as {
    _handler: (
      ctx: { db: MockDb },
      args: { slugs: string[] },
    ) => Promise<{ deletedCount: number }>;
  }
)._handler;

interface MockDb {
  query: (table: string) => {
    withIndex: () => { collect: () => Promise<Array<Record<string, unknown>>> };
    collect: () => Promise<Array<Record<string, unknown>>>;
  };
  patch: (id: string, value: Record<string, unknown>) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

test("deleteRemovedSystemSkills removes active config references before hard delete", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const removed = "skill_removed";
  const keep = "skill_keep";

  const rows: Record<string, Array<Record<string, unknown>>> = {
    skills: [
      { _id: removed, slug: "removed-skill", scope: "system" },
      { _id: "skill_user_same_slug", slug: "removed-skill", scope: "user" },
    ],
    userPreferences: [{
      _id: "prefs_1",
      skillDefaults: [
        { skillId: removed, state: "always" },
        { skillId: keep, state: "available" },
      ],
    }],
    personas: [{
      _id: "persona_1",
      skillOverrides: [{ skillId: removed, state: "available" }],
    }],
    chats: [{
      _id: "chat_1",
      skillOverrides: [{ skillId: removed, state: "never" }],
    }],
    scheduledJobs: [{
      _id: "job_1",
      turnSkillOverrides: [
        { skillId: removed, state: "always" },
        { skillId: keep, state: "available" },
      ],
      steps: [
        {
          prompt: "Draft",
          modelId: "model_1",
          turnSkillOverrides: [{ skillId: removed, state: "always" }],
        },
        {
          prompt: "Review",
          modelId: "model_1",
          turnSkillOverrides: [{ skillId: keep, state: "available" }],
        },
      ],
    }],
  };

  const result = await deleteRemovedSystemSkillsHandler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => rows[table] ?? [],
        }),
        collect: async () => rows[table] ?? [],
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  }, { slugs: ["removed-skill"] });

  assert.deepEqual(result, { deletedCount: 1 });
  assert.deepEqual(deleted, [removed]);
  assert.ok(!deleted.includes("skill_user_same_slug"));

  const prefsPatch = patches.find((patch) => patch.id === "prefs_1");
  assert.deepEqual(prefsPatch?.value.skillDefaults, [{ skillId: keep, state: "available" }]);

  const personaPatch = patches.find((patch) => patch.id === "persona_1");
  assert.equal(personaPatch?.value.skillOverrides, undefined);

  const chatPatch = patches.find((patch) => patch.id === "chat_1");
  assert.equal(chatPatch?.value.skillOverrides, undefined);

  const jobPatch = patches.find((patch) => patch.id === "job_1");
  assert.deepEqual(jobPatch?.value.turnSkillOverrides, [{ skillId: keep, state: "available" }]);
  const patchedSteps = jobPatch?.value.steps as Array<Record<string, unknown>>;
  assert.equal(patchedSteps[0]?.turnSkillOverrides, undefined);
  assert.deepEqual(patchedSteps[1]?.turnSkillOverrides, [{ skillId: keep, state: "available" }]);
});
