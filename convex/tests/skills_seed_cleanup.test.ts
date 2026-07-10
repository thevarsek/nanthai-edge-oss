import assert from "node:assert/strict";
import test from "node:test";

import { upsertSystemSkill } from "../skills/mutations_seed";
import {
  cleanupRemovedSkillChatsPage,
  cleanupRemovedSkillPersonasPage,
  cleanupRemovedSkillPreferencesPage,
  cleanupRemovedSkillScheduledJobsPage,
  deleteRemovedSystemSkillRows,
  findRemovedSystemSkillIds,
} from "../skills/mutations_seed_cleanup";

type CleanupPageResult = { continueCursor: string; isDone: boolean; patchedCount: number };
type CleanupHandler = (
  ctx: unknown,
  args: { skillIds: string[]; cursor?: string },
) => Promise<CleanupPageResult>;

const findRemovedHandler = (findRemovedSystemSkillIds as unknown as {
  _handler: (ctx: unknown, args: { slugs: string[] }) => Promise<string[]>;
})._handler;
const cleanupHandlers = [
  cleanupRemovedSkillPreferencesPage,
  cleanupRemovedSkillPersonasPage,
  cleanupRemovedSkillChatsPage,
  cleanupRemovedSkillScheduledJobsPage,
].map((fn) => (fn as unknown as { _handler: CleanupHandler })._handler);
const deleteRemovedHandler = (deleteRemovedSystemSkillRows as unknown as {
  _handler: (ctx: unknown, args: { skillIds: string[] }) => Promise<{ deletedCount: number }>;
})._handler;

const upsertSystemSkillHandler = (
  upsertSystemSkill as unknown as {
    _handler: (
      ctx: { db: MockDb & { insert: (table: string, value: Record<string, unknown>) => Promise<string> } },
      args: Record<string, unknown>,
    ) => Promise<string>;
  }
)._handler;

interface MockDb {
  query: (table: string) => {
    withIndex: () => { collect: () => Promise<Array<Record<string, unknown>>> };
    collect: () => Promise<Array<Record<string, unknown>>>;
    paginate?: () => Promise<{
      page: Array<Record<string, unknown>>;
      continueCursor: string;
      isDone: boolean;
    }>;
  };
  get?: (id: string) => Promise<Record<string, unknown> | null>;
  patch: (id: string, value: Record<string, unknown>) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

async function runRemovedCleanup(
  ctx: { db: MockDb },
  slugs: string[],
): Promise<{ deletedCount: number }> {
  const skillIds = await findRemovedHandler(ctx, { slugs });
  for (const cleanup of cleanupHandlers) {
    await cleanup(ctx, { skillIds });
  }
  return await deleteRemovedHandler(ctx, { skillIds });
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

  const result = await runRemovedCleanup({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => rows[table] ?? [],
        }),
        collect: async () => rows[table] ?? [],
        paginate: async () => ({
          page: rows[table] ?? [],
          continueCursor: "done",
          isDone: true,
        }),
      }),
      get: async (id: string) =>
        Object.values(rows).flat().find((row) => row._id === id) ?? null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  }, ["removed-skill"]);

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

test("upsertSystemSkill inserts missing system skills and patches existing system rows only", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const baseArgs = {
    slug: "system-helper",
    name: "System Helper",
    summary: "Helps with system tasks.",
    instructionsRaw: "Help with the current conversation.",
    compilationStatus: "compiled",
    scope: "system",
    origin: "nanthaiBuiltin",
    visibility: "visible",
    lockState: "locked",
    status: "active",
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredIntegrationIds: [],
  };
  const rows: Record<string, Array<Record<string, unknown>>> = {
    skills: [
      { _id: "skill_user_same_slug", slug: "system-helper", scope: "user", version: 7 },
    ],
  };
  const db = {
    query: (table: string) => ({
      withIndex: () => ({
        collect: async () => rows[table] ?? [],
      }),
      collect: async () => rows[table] ?? [],
    }),
    patch: async (id: string, value: Record<string, unknown>) => {
      patches.push({ id, value });
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      inserts.push({ table, value });
      return "skill_inserted";
    },
    delete: async () => undefined,
  };

  const insertedId = await upsertSystemSkillHandler({ db }, baseArgs);
  assert.equal(insertedId, "skill_inserted");
  assert.equal(inserts[0]?.value.ownerUserId, undefined);
  assert.deepEqual(inserts[0]?.value.requiredToolProfiles, []);
  assert.deepEqual(inserts[0]?.value.requiredCapabilities, []);

  rows.skills = [
    { _id: "skill_existing_system", slug: "system-helper", scope: "system", version: 3 },
    { _id: "skill_user_same_slug", slug: "system-helper", scope: "user", version: 7 },
  ];
  const patchedId = await upsertSystemSkillHandler({ db }, {
    ...baseArgs,
    requiredToolProfiles: ["docs"],
    requiredCapabilities: ["pro"],
  });

  assert.equal(patchedId, "skill_existing_system");
  assert.equal(patches[0]?.id, "skill_existing_system");
  assert.equal(patches[0]?.value.version, 4);
  assert.deepEqual(patches[0]?.value.requiredToolProfiles, ["docs"]);
  assert.deepEqual(patches[0]?.value.requiredCapabilities, ["pro"]);
});

test("deleteRemovedSystemSkills exits without patches when removed slugs have no system matches", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const result = await runRemovedCleanup({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => table === "skills"
            ? [{ _id: "skill_user", slug: "removed-skill", scope: "user" }]
            : [],
        }),
        collect: async () => [],
        paginate: async () => ({ page: [], continueCursor: "done", isDone: true }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  }, ["removed-skill"]);

  assert.deepEqual(result, { deletedCount: 0 });
  assert.deepEqual(patches, []);
  assert.deepEqual(deleted, []);
});

test("deleteRemovedSystemSkills deletes removed skills without touching unrelated owner config", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    skills: [{ _id: "skill_removed", slug: "removed-skill", scope: "system" }],
    userPreferences: [{
      _id: "prefs_1",
      skillDefaults: [{ skillId: "skill_keep", state: "available" }],
    }],
    personas: [{
      _id: "persona_1",
      skillOverrides: [{ skillId: "skill_keep", state: "always" }],
    }],
    chats: [{
      _id: "chat_1",
      skillOverrides: [{ skillId: "skill_keep", state: "never" }],
    }],
    scheduledJobs: [{
      _id: "job_1",
      turnSkillOverrides: [{ skillId: "skill_keep", state: "available" }],
      steps: [
        { prompt: "No overrides" },
        { prompt: "Keep override", turnSkillOverrides: [{ skillId: "skill_keep", state: "always" }] },
      ],
    }],
  };

  const result = await runRemovedCleanup({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => rows[table] ?? [],
        }),
        collect: async () => rows[table] ?? [],
        paginate: async () => ({
          page: rows[table] ?? [],
          continueCursor: "done",
          isDone: true,
        }),
      }),
      get: async (id: string) =>
        Object.values(rows).flat().find((row) => row._id === id) ?? null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  }, ["removed-skill"]);

  assert.deepEqual(result, { deletedCount: 1 });
  assert.deepEqual(deleted, ["skill_removed"]);
  assert.deepEqual(patches, []);
});

test("upsertSystemSkill bumps legacy system rows with undefined version", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const db = {
    query: () => ({
      withIndex: () => ({
        collect: async () => [{ _id: "skill_legacy", slug: "legacy", scope: "system" }],
      }),
      collect: async () => [],
    }),
    patch: async (id: string, value: Record<string, unknown>) => {
      patches.push({ id, value });
    },
    insert: async () => "unused",
    delete: async () => undefined,
  };

  const id = await upsertSystemSkillHandler({ db }, {
    slug: "legacy",
    name: "Legacy",
    summary: "Legacy summary",
    instructionsRaw: "Help safely.",
    instructionsCompiled: undefined,
    compilationStatus: "compiled",
    scope: "system",
    origin: "nanthaiBuiltin",
    visibility: "hidden",
    lockState: "locked",
    status: "active",
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredToolProfiles: undefined,
    requiredIntegrationIds: [],
    requiredCapabilities: undefined,
  });

  assert.equal(id, "skill_legacy");
  assert.equal(patches[0]?.value.version, 1);
  assert.deepEqual(patches[0]?.value.requiredToolProfiles, []);
  assert.deepEqual(patches[0]?.value.requiredCapabilities, []);
});
