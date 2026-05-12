import assert from "node:assert/strict";
import test from "node:test";

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

function createToolCtx(overrides: {
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

test("skill management tools expose useful no-op and validation responses", async () => {
  const emptyList = await listSkills.execute(createToolCtx({
    runQuery: async () => [],
  }), {});
  assert.equal(emptyList.success, true);
  assert.equal((emptyList.data as any).count, 0);
  assert.match(String((emptyList.data as any).message), /No skills available/);

  const missingSummary = await createSkill.execute(createToolCtx(), {
    name: "Writer",
    instructionsRaw: "Write.",
  });
  assert.equal(missingSummary.success, false);
  assert.match(String(missingSummary.error), /summary/);

  const missingInstructions = await createSkill.execute(createToolCtx(), {
    name: "Writer",
    summary: "Writes",
  });
  assert.equal(missingInstructions.success, false);
  assert.match(String(missingInstructions.error), /instructionsRaw/);

  const createFailure = await createSkill.execute(createToolCtx({
    runMutation: async () => {
      throw "database offline";
    },
  }), {
    name: "Writer",
    summary: "Writes",
    instructionsRaw: "Write.",
  });
  assert.equal(createFailure.success, false);
  assert.match(String(createFailure.error), /database offline/);
});

test("update and delete skill tools keep direct-id and warning branches observable", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const updateResult = await updateSkill.execute(createToolCtx({
    runMutation: async (args) => {
      updates.push(args);
      return { skillId: args.skillId, validationWarnings: ["docs profile inferred"] };
    },
  }), {
    skillId: "skill_1",
    summary: "  Trimmed summary ",
  });
  assert.equal(updateResult.success, true);
  assert.match(String((updateResult.data as any).message), /Warnings: docs profile inferred/);
  assert.deepEqual(updates[0], {
    skillId: "skill_1",
    userId: "user_1",
    name: undefined,
    summary: "  Trimmed summary ",
    instructionsRaw: undefined,
    runtimeMode: undefined,
    requiredToolIds: undefined,
    requiredToolProfiles: undefined,
    requiredIntegrationIds: undefined,
    requiredCapabilities: undefined,
  });

  const deletes: Array<Record<string, unknown>> = [];
  const directDelete = await deleteSkill.execute(createToolCtx({
    runMutation: async (args) => {
      deletes.push(args);
    },
  }), {
    skillId: "skill_1",
  });
  assert.equal(directDelete.success, true);
  assert.equal((directDelete.data as any).deletedSkillName, "");
  assert.deepEqual(deletes[0], { skillId: "skill_1", userId: "user_1" });
});

test("chat skill tools distinguish missing chat, missing slug, and disable mutation failures", async () => {
  const missingSlug = await disableSkillForChat.execute(createToolCtx(), {
    chatId: "chat_1",
  });
  assert.equal(missingSlug.success, false);
  assert.match(String(missingSlug.error), /skillSlug/);

  const chatMissing = await enableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : null,
  }), {
    chatId: "chat_missing",
    skillSlug: "docs",
  });
  assert.equal(chatMissing.success, false);
  assert.match(String(chatMissing.error), /Chat not found/);

  const mutationFailure = await disableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "user_1", skillOverrides: [] },
    runMutation: async () => {
      throw new Error("disable patch failed");
    },
  }), {
    chatId: "chat_1",
    skillSlug: "docs",
  });
  assert.equal(mutationFailure.success, false);
  assert.match(String(mutationFailure.error), /disable patch failed/);
});

test("persona skill tools cover persona-id misses, name misses, ambiguous removes, and remove failures", async () => {
  const missingSlug = await assignSkillToPersona.execute(createToolCtx(), {
    personaId: "persona_1",
  });
  assert.equal(missingSlug.success, false);
  assert.match(String(missingSlug.error), /skillSlug/);

  const missingById = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_2", displayName: "Other", skillOverrides: [] }],
  }), {
    personaId: "persona_missing",
    skillSlug: "docs",
  });
  assert.equal(missingById.success, false);
  assert.match(String(missingById.error), /Could not resolve persona/);

  const missingByName = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [] }],
  }), {
    personaName: "writer",
    skillSlug: "docs",
  });
  assert.equal(missingByName.success, false);
  assert.match(String(missingByName.error), /No persona found/);

  const ambiguousRemove = await removeSkillFromPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [
          { _id: "persona_1", displayName: "Researcher", skillOverrides: [] },
          { _id: "persona_2", displayName: "Research Lead", skillOverrides: [] },
        ],
  }), {
    personaName: "research",
    skillSlug: "docs",
  });
  assert.equal(ambiguousRemove.success, false);
  assert.deepEqual((ambiguousRemove.data as any).ambiguousMatches, ["Researcher", "Research Lead"]);

  const removeFailure = await removeSkillFromPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [{ skillId: "skill_1", state: "available" }] }],
    runMutation: async () => {
      throw new Error("remove patch failed");
    },
  }), {
    personaId: "persona_1",
    skillSlug: "docs",
  });
  assert.equal(removeFailure.success, false);
  assert.match(String(removeFailure.error), /remove patch failed/);
});

test("skill assignment tools preserve existing overrides while applying real chat and persona changes", async () => {
  const chatMutations: Array<Record<string, unknown>> = [];
  const disabled = await disableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : {
          _id: "chat_1",
          userId: "user_1",
          skillOverrides: [
            { skillId: "skill_1", state: "available" },
            { skillId: "skill_other", state: "always" },
          ],
        },
    runMutation: async (args) => {
      chatMutations.push(args);
    },
  }), {
    chatId: "chat_1",
    skillSlug: " docs ",
  });
  assert.equal(disabled.success, true);
  assert.deepEqual(chatMutations[0]?.skillOverrides, [
    { skillId: "skill_other", state: "always" },
    { skillId: "skill_1", state: "never" },
  ]);

  const alreadyDisabled = await disableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "user_1", skillOverrides: [{ skillId: "skill_1", state: "never" }] },
  }), {
    chatId: "chat_1",
    skillSlug: "docs",
  });
  assert.equal(alreadyDisabled.success, true);
  assert.match(String((alreadyDisabled.data as any).message), /already disabled/);

  const unauthorizedChat = await enableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "other_user", skillOverrides: [] },
  }), {
    chatId: "chat_1",
    skillSlug: "docs",
  });
  assert.equal(unauthorizedChat.success, false);
  assert.match(String(unauthorizedChat.error), /Not authorized/);

  const personaMutations: Array<Record<string, unknown>> = [];
  const assigned = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [{ skillId: "skill_1", state: "never" }] }],
    runMutation: async (args) => {
      personaMutations.push(args);
    },
  }), {
    personaName: "research",
    skillSlug: "docs",
  });
  assert.equal(assigned.success, true);
  assert.deepEqual(personaMutations[0]?.skillOverrides, [{ skillId: "skill_1", state: "available" }]);

  const alreadyAssigned = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [{ skillId: "skill_1", state: "always" }] }],
  }), {
    personaId: "persona_1",
    skillSlug: "docs",
  });
  assert.equal(alreadyAssigned.success, true);
  assert.match(String((alreadyAssigned.data as any).message), /already assigned/);

  const notAssigned = await removeSkillFromPersona.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [{ skillId: "other", state: "available" }] }],
  }), {
    personaId: "persona_1",
    skillSlug: "docs",
  });
  assert.equal(notAssigned.success, true);
  assert.match(String((notAssigned.data as any).message), /was not assigned/);
});
