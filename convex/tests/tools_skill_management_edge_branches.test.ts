import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  assignSkillToPersona,
  createSkill,
  deleteSkill,
  disableSkillForChat,
  enableSkillForChat,
  listSkills,
  removeSkillFromPersona,
  updateSkill,
} from "../tools/skill_management";

function toolCtx(overrides: {
  runQuery?: (args: Record<string, unknown>) => Promise<unknown>;
  runMutation?: (args: Record<string, unknown>) => Promise<unknown>;
} = {}) {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async (_ref: unknown, args: Record<string, unknown>) =>
        overrides.runQuery ? overrides.runQuery(args) : null,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) =>
        overrides.runMutation ? overrides.runMutation(args) : undefined,
    },
  } as any;
}

test("listSkills normalizes optional metadata and reports non-Error query failures", async () => {
  const listed = await listSkills.execute(toolCtx({
    runQuery: async () => [{
      _id: "skill_1",
      slug: "docs",
      name: "Docs",
      summary: "Draft documents",
      runtimeMode: "toolAugmented",
      scope: "system",
      origin: "catalog",
      compilationStatus: "compiled",
    }],
  }), {});
  assert.equal(listed.success, true);
  assert.deepEqual((listed.data as any).skills[0].requiredToolProfiles, []);
  assert.deepEqual((listed.data as any).skills[0].requiredCapabilities, []);

  const failed = await listSkills.execute(toolCtx({
    runQuery: async () => {
      throw "read failed";
    },
  }), {});
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /read failed/);
});

test("createSkill and updateSkill surface incompatible validation detail and generic failures", async () => {
  const incompatibleCreate = await createSkill.execute(toolCtx({
    runMutation: async () => {
      throw new ConvexError({ code: "SKILL_INCOMPATIBLE" });
    },
  }), {
    name: "Shell Skill",
    summary: "Uses local tools",
    instructionsRaw: "Run a local shell.",
  });
  assert.equal(incompatibleCreate.success, false);
  assert.match(String(incompatibleCreate.error), /incompatible content/);

  const failedCreate = await createSkill.execute(toolCtx({
    runMutation: async () => {
      throw new Error("duplicate skill");
    },
  }), {
    name: "Writer",
    summary: "Writes",
    instructionsRaw: "Write clearly.",
  });
  assert.equal(failedCreate.success, false);
  assert.match(String(failedCreate.error), /duplicate skill/);

  const updated = await updateSkill.execute(toolCtx({
    runMutation: async () => ({ validationWarnings: [] }),
  }), {
    skillId: "skill_1",
    instructionsRaw: "Revalidate instructions.",
  });
  assert.equal(updated.success, true);
  assert.match(String((updated.data as any).message), /Instructions and profile metadata were revalidated/);

  const incompatibleUpdate = await updateSkill.execute(toolCtx({
    runMutation: async () => {
      throw new ConvexError({ code: "SKILL_INCOMPATIBLE" });
    },
  }), {
    skillId: "skill_1",
    instructionsRaw: "Use MCP.",
  });
  assert.equal(incompatibleUpdate.success, false);
  assert.match(String(incompatibleUpdate.error), /Incompatible instructions/);

  const failedUpdate = await updateSkill.execute(toolCtx({
    runMutation: async () => {
      throw "update offline";
    },
  }), { skillId: "skill_1", summary: "New" });
  assert.equal(failedUpdate.success, false);
  assert.match(String(failedUpdate.error), /update offline/);
});

test("deleteSkill handles unresolved names and non-Error delete failures", async () => {
  const unresolved = await deleteSkill.execute(toolCtx({
    runQuery: async () => [{ name: "Nameless match" }],
  }), { skillName: "name" });
  assert.equal(unresolved.success, false);
  assert.match(String(unresolved.error), /Could not resolve/);

  const failedDelete = await deleteSkill.execute(toolCtx({
    runMutation: async () => {
      throw "delete offline";
    },
  }), { skillId: "skill_1" });
  assert.equal(failedDelete.success, false);
  assert.match(String(failedDelete.error), /delete offline/);
});

test("chat skill tools validate missing inputs, absent skills, default overrides, and non-Error failures", async () => {
  assert.match(String((await enableSkillForChat.execute(toolCtx(), { skillSlug: "docs" })).error), /chatId/);
  assert.match(String((await disableSkillForChat.execute(toolCtx(), { skillSlug: "docs" })).error), /chatId/);

  const missingEnableSkill = await enableSkillForChat.execute(toolCtx({
    runQuery: async () => null,
  }), { chatId: "chat_1", skillSlug: "missing" });
  assert.match(String(missingEnableSkill.error), /No skill found/);

  const missingDisableSkill = await disableSkillForChat.execute(toolCtx({
    runQuery: async () => null,
  }), { chatId: "chat_1", skillSlug: "missing" });
  assert.match(String(missingDisableSkill.error), /No skill found/);

  const mutations: Array<Record<string, unknown>> = [];
  const enabled = await enableSkillForChat.execute(toolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "user_1" },
    runMutation: async (args) => {
      mutations.push(args);
    },
  }), { chatId: "chat_1", skillSlug: "docs" });
  assert.equal(enabled.success, true);
  assert.deepEqual(mutations[0].skillOverrides, [{ skillId: "skill_1", state: "available" }]);

  const failedDisable = await disableSkillForChat.execute(toolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "user_1" },
    runMutation: async () => {
      throw "disable offline";
    },
  }), { chatId: "chat_1", skillSlug: "docs" });
  assert.equal(failedDisable.success, false);
  assert.match(String(failedDisable.error), /disable offline/);
});

test("persona skill tools cover absent skills, default overrides, unresolved ids, and non-Error failures", async () => {
  assert.match(String((await removeSkillFromPersona.execute(toolCtx(), {})).error), /personaId/);
  assert.match(String((await removeSkillFromPersona.execute(toolCtx(), { personaId: "persona_1" })).error), /skillSlug/);

  const noSkillAssign = await assignSkillToPersona.execute(toolCtx({
    runQuery: async () => null,
  }), { personaId: "persona_1", skillSlug: "missing" });
  assert.match(String(noSkillAssign.error), /No skill found/);

  const noSkillRemove = await removeSkillFromPersona.execute(toolCtx({
    runQuery: async () => null,
  }), { personaId: "persona_1", skillSlug: "missing" });
  assert.match(String(noSkillRemove.error), /No skill found/);

  const assignedMutations: Array<Record<string, unknown>> = [];
  const assigned = await assignSkillToPersona.execute(toolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher" }],
    runMutation: async (args) => {
      assignedMutations.push(args);
    },
  }), { personaId: "persona_1", skillSlug: "docs" });
  assert.equal(assigned.success, true);
  assert.deepEqual(assignedMutations[0].skillOverrides, [{ skillId: "skill_1", state: "available" }]);

  const unresolvedRemove = await removeSkillFromPersona.execute(toolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_2", displayName: "Other" }],
  }), { personaId: "persona_1", skillSlug: "docs" });
  assert.match(String(unresolvedRemove.error), /Could not resolve persona/);

  const failedRemove = await removeSkillFromPersona.execute(toolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [{ skillId: "skill_1", state: "available" }] }],
    runMutation: async () => {
      throw "remove offline";
    },
  }), { personaId: "persona_1", skillSlug: "docs" });
  assert.equal(failedRemove.success, false);
  assert.match(String(failedRemove.error), /remove offline/);
});
