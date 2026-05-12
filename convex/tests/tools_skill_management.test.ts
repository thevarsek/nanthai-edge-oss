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

test("listSkills returns normalized catalog entries and maps failures", async () => {
  const success = await listSkills.execute(createToolCtx({
    runQuery: async () => ([
      {
        _id: "skill_1",
        slug: "brief-writer",
        name: "Brief Writer",
        summary: "Writes briefs",
        runtimeMode: "textOnly",
        requiredToolProfiles: ["docs"],
        requiredCapabilities: ["mcpRuntime"],
        scope: "user",
        origin: "userCreated",
        compilationStatus: "compiled",
      },
    ]),
  }), {});
  assert.equal(success.success, true);
  assert.equal((success.data as any).count, 1);
  assert.equal((success.data as any).skills[0].slug, "brief-writer");

  const failure = await listSkills.execute(createToolCtx({
    runQuery: async () => {
      throw new Error("db unavailable");
    },
  }), {});
  assert.equal(failure.success, false);
  assert.match(String(failure.error), /Failed to list skills/);
});

test("createSkill validates input, creates skills, and surfaces compatibility failures", async () => {
  const missing = await createSkill.execute(createToolCtx(), {
    summary: "Missing name",
    instructionsRaw: "Do work.",
  });
  assert.equal(missing.success, false);

  const badMode = await createSkill.execute(createToolCtx(), {
    name: "Writer",
    summary: "Writes docs",
    instructionsRaw: "Do work.",
    runtimeMode: "invalid",
  });
  assert.equal(badMode.success, false);
  assert.match(String(badMode.error), /runtimeMode/);

  const mutations: Array<Record<string, unknown>> = [];
  const created = await createSkill.execute(createToolCtx({
    runMutation: async (args) => {
      mutations.push(args);
      return { skillId: "skill_new", validationWarnings: [] };
    },
  }), {
    name: "  Legal Brief Writer ",
    summary: " Draft legal briefs. ",
    instructionsRaw: "Write carefully.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
    requiredToolProfiles: ["docs"],
  });
  assert.equal(created.success, true);
  assert.equal((created.data as any).skillId, "skill_new");
  assert.deepEqual(mutations[0], {
    userId: "user_1",
    name: "Legal Brief Writer",
    summary: "Draft legal briefs.",
    instructionsRaw: "Write carefully.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
    requiredToolProfiles: ["docs"],
    requiredIntegrationIds: undefined,
    requiredCapabilities: undefined,
  });

  const incompatible = await createSkill.execute(createToolCtx({
    runMutation: async () => {
      throw new ConvexError({ code: "SKILL_INCOMPATIBLE" as const, message: "Uses bash" });
    },
  }), {
    name: "Shell skill",
    summary: "Uses bash",
    instructionsRaw: "run bash",
  });
  assert.equal(incompatible.success, false);
  assert.match(String(incompatible.error), /incompatible/i);

  const warned = await createSkill.execute(createToolCtx({
    runMutation: async () => ({
      skillId: "skill_warn",
      validationWarnings: ["Profile docs was inferred"],
    }),
  }), {
    name: "Warned",
    summary: "Has warnings",
    instructionsRaw: "Write a document.",
  });
  assert.equal(warned.success, true);
  assert.match(String((warned.data as any).message), /Warnings: Profile docs was inferred/);
});

test("updateSkill resolves by name, detects ambiguity, validates runtime mode, and updates by id", async () => {
  const missing = await updateSkill.execute(createToolCtx(), {});
  assert.equal(missing.success, false);

  const noMatch = await updateSkill.execute(createToolCtx({
    runQuery: async () => [],
  }), {
    skillName: "missing",
  });
  assert.equal(noMatch.success, false);
  assert.match(String(noMatch.error), /No user skill found/);

  const badMode = await updateSkill.execute(createToolCtx(), {
    skillId: "skill_1",
    runtimeMode: "browserAugmented",
  });
  assert.equal(badMode.success, false);
  assert.match(String(badMode.error), /runtimeMode/);

  const ambiguous = await updateSkill.execute(createToolCtx({
    runQuery: async () => ([
      { _id: "skill_1", name: "Brief Writer" },
      { _id: "skill_2", name: "Brief Rewriter" },
    ]),
  }), {
    skillName: "brief",
  });
  assert.equal(ambiguous.success, false);
  assert.deepEqual((ambiguous.data as any).ambiguousMatches, ["Brief Writer", "Brief Rewriter"]);

  const mutations: Array<Record<string, unknown>> = [];
  const updated = await updateSkill.execute(createToolCtx({
    runMutation: async (args) => {
      mutations.push(args);
      return { skillId: "skill_1", validationWarnings: [] };
    },
  }), {
    skillId: "skill_1",
    name: "Updated Writer",
    runtimeMode: "sandboxAugmented",
    requiredCapabilities: ["mcpRuntime"],
  });
  assert.equal(updated.success, true);
  assert.deepEqual(mutations[0], {
    skillId: "skill_1",
    userId: "user_1",
    name: "Updated Writer",
    summary: undefined,
    instructionsRaw: undefined,
    runtimeMode: "sandboxAugmented",
    requiredToolIds: undefined,
    requiredToolProfiles: undefined,
    requiredIntegrationIds: undefined,
    requiredCapabilities: ["mcpRuntime"],
  });

  const incompatible = await updateSkill.execute(createToolCtx({
    runMutation: async () => {
      throw new ConvexError({ code: "SKILL_INCOMPATIBLE" as const, message: "Uses MCP" });
    },
  }), {
    skillId: "skill_1",
    instructionsRaw: "Uses MCP",
  });
  assert.equal(incompatible.success, false);
  assert.match(String(incompatible.error), /Incompatible instructions/);

  const mutationFailure = await updateSkill.execute(createToolCtx({
    runMutation: async () => {
      throw new Error("db write failed");
    },
  }), {
    skillId: "skill_1",
    name: "Updated",
  });
  assert.equal(mutationFailure.success, false);
  assert.match(String(mutationFailure.error), /Failed to update skill: db write failed/);
});

test("deleteSkill resolves by name and deletes uniquely matched skills", async () => {
  const missing = await deleteSkill.execute(createToolCtx(), {});
  assert.equal(missing.success, false);

  const noMatch = await deleteSkill.execute(createToolCtx({
    runQuery: async () => [],
  }), {
    skillName: "missing",
  });
  assert.equal(noMatch.success, false);
  assert.match(String(noMatch.error), /No user skill found/);

  const ambiguous = await deleteSkill.execute(createToolCtx({
    runQuery: async () => ([
      { _id: "skill_1", name: "Research" },
      { _id: "skill_2", name: "Research Plus" },
    ]),
  }), {
    skillName: "research",
  });
  assert.equal(ambiguous.success, false);
  assert.deepEqual((ambiguous.data as any).ambiguousMatches, ["Research", "Research Plus"]);

  const deleted: Array<Record<string, unknown>> = [];
  const success = await deleteSkill.execute(createToolCtx({
    runQuery: async () => ([
      { _id: "skill_1", name: "Research" },
    ]),
    runMutation: async (args) => {
      deleted.push(args);
    },
  }), {
    skillName: "research",
  });
  assert.equal(success.success, true);
  assert.deepEqual(deleted[0], {
    skillId: "skill_1",
    userId: "user_1",
  });

  const directFailure = await deleteSkill.execute(createToolCtx({
    runMutation: async () => {
      throw new Error("system skill");
    },
  }), {
    skillId: "system_skill",
  });
  assert.equal(directFailure.success, false);
  assert.match(String(directFailure.error), /Failed to delete skill: system skill/);
});

test("enableSkillForChat and disableSkillForChat update discoverable and disabled ids", async () => {
  const chatState = {
    _id: "chat_1",
    userId: "user_1",
    skillOverrides: [
      { skillId: "skill_1", state: "available" },
      { skillId: "skill_2", state: "never" },
    ],
  };
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_2", name: "Sheets" };
      if (args.chatId) return chatState;
      return null;
    },
    runMutation: async (args) => {
      mutations.push(args);
    },
  });

  const enabled = await enableSkillForChat.execute(ctx, {
    chatId: "chat_1",
    skillSlug: "sheets",
  });
  assert.equal(enabled.success, true);
  assert.deepEqual(mutations[0], {
    chatId: "chat_1",
    userId: "user_1",
    skillOverrides: [
      { skillId: "skill_1", state: "available" },
      { skillId: "skill_2", state: "available" },
    ],
  });

  chatState.skillOverrides = [
    { skillId: "skill_1", state: "available" },
    { skillId: "skill_2", state: "available" },
  ];
  const disabled = await disableSkillForChat.execute(ctx, {
    chatId: "chat_1",
    skillSlug: "sheets",
  });
  assert.equal(disabled.success, true);
  assert.deepEqual(mutations[1], {
    chatId: "chat_1",
    userId: "user_1",
    skillOverrides: [
      { skillId: "skill_1", state: "available" },
      { skillId: "skill_2", state: "never" },
    ],
  });
});

test("chat skill management covers missing, unauthorized, already-set, and mutation failure branches", async () => {
  const missingArgs = await enableSkillForChat.execute(createToolCtx(), { skillSlug: "docs" });
  assert.equal(missingArgs.success, false);
  assert.match(String(missingArgs.error), /chatId/);

  const missingSkill = await enableSkillForChat.execute(createToolCtx({
    runQuery: async () => null,
  }), {
    chatId: "chat_1",
    skillSlug: "missing",
  });
  assert.equal(missingSkill.success, false);
  assert.match(String(missingSkill.error), /No skill found/);

  const unauthorized = await disableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "other_user", skillOverrides: [] },
  }), {
    chatId: "chat_1",
    skillSlug: "docs",
  });
  assert.equal(unauthorized.success, false);
  assert.match(String(unauthorized.error), /Not authorized/);

  const alreadyEnabled = await enableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "user_1", skillOverrides: [{ skillId: "skill_1", state: "always" }] },
  }), {
    chatId: "chat_1",
    skillSlug: "docs",
  });
  assert.equal(alreadyEnabled.success, true);
  assert.match(String((alreadyEnabled.data as any).message), /already enabled/);

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

  const mutationFailure = await enableSkillForChat.execute(createToolCtx({
    runQuery: async (args) => args.slug
      ? { _id: "skill_1", name: "Docs" }
      : { _id: "chat_1", userId: "user_1", skillOverrides: [] },
    runMutation: async () => {
      throw new Error("patch failed");
    },
  }), {
    chatId: "chat_1",
    skillSlug: "docs",
  });
  assert.equal(mutationFailure.success, false);
  assert.match(String(mutationFailure.error), /patch failed/);
});

test("assignSkillToPersona and removeSkillFromPersona resolve personas and manage discoverable skills", async () => {
  const missingPersona = await assignSkillToPersona.execute(createToolCtx(), {
    skillSlug: "docs",
  });
  assert.equal(missingPersona.success, false);
  assert.match(String(missingPersona.error), /personaId/);

  const missingSkill = await removeSkillFromPersona.execute(createToolCtx({
    runQuery: async () => null,
  }), {
    personaId: "persona_1",
    skillSlug: "missing",
  });
  assert.equal(missingSkill.success, false);
  assert.match(String(missingSkill.error), /No skill found/);

  const personas = [
    { _id: "persona_1", displayName: "Researcher", skillOverrides: [] },
    { _id: "persona_2", displayName: "Research Assistant", skillOverrides: [] },
  ];

  const ambiguous = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      if (args.userId) return personas;
      return null;
    },
  }), {
    personaName: "research",
    skillSlug: "research-skill",
  });
  assert.equal(ambiguous.success, false);

  const mutations: Array<Record<string, unknown>> = [];
  const successCtx = createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      if (args.userId) return [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [] }];
      return null;
    },
    runMutation: async (args) => {
      mutations.push(args);
    },
  });

  const assigned = await assignSkillToPersona.execute(successCtx, {
    personaName: "researcher",
    skillSlug: "research-skill",
  });
  assert.equal(assigned.success, true);
  assert.deepEqual(mutations[0], {
    personaId: "persona_1",
    userId: "user_1",
    skillOverrides: [{ skillId: "skill_1", state: "available" }],
  });

  const removeCtx = createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      if (args.userId) {
        return [{
          _id: "persona_1",
          displayName: "Researcher",
          skillOverrides: [
            { skillId: "skill_1", state: "available" },
            { skillId: "skill_2", state: "available" },
          ],
        }];
      }
      return null;
    },
    runMutation: async (args) => {
      mutations.push(args);
    },
  });
  const removed = await removeSkillFromPersona.execute(removeCtx, {
    personaName: "researcher",
    skillSlug: "research-skill",
  });
  assert.equal(removed.success, true);
  assert.deepEqual(mutations[1], {
    personaId: "persona_1",
    userId: "user_1",
    skillOverrides: [{ skillId: "skill_2", state: "available" }],
  });

  const alreadyAssigned = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      return [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [{ skillId: "skill_1", state: "available" }] }];
    },
  }), {
    personaId: "persona_1",
    skillSlug: "research-skill",
  });
  assert.equal(alreadyAssigned.success, true);
  assert.match(String((alreadyAssigned.data as any).message), /already assigned/);

  const notAssigned = await removeSkillFromPersona.execute(createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      return [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [] }];
    },
  }), {
    personaId: "persona_1",
    skillSlug: "research-skill",
  });
  assert.equal(notAssigned.success, true);
  assert.match(String((notAssigned.data as any).message), /was not assigned/);

  const personaMutationFailure = await assignSkillToPersona.execute(createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      return [{ _id: "persona_1", displayName: "Researcher", skillOverrides: [] }];
    },
    runMutation: async () => {
      throw new Error("persona patch failed");
    },
  }), {
    personaId: "persona_1",
    skillSlug: "research-skill",
  });
  assert.equal(personaMutationFailure.success, false);
  assert.match(String(personaMutationFailure.error), /persona patch failed/);
});
