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
        requiredCapabilities: ["sandboxRuntime"],
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
});

test("updateSkill resolves by name, detects ambiguity, validates runtime mode, and updates by id", async () => {
  const missing = await updateSkill.execute(createToolCtx(), {});
  assert.equal(missing.success, false);

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
    requiredCapabilities: ["sandboxRuntime"],
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
    requiredCapabilities: ["sandboxRuntime"],
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
});

test("deleteSkill resolves by name and deletes uniquely matched skills", async () => {
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
});

test("enableSkillForChat and disableSkillForChat update discoverable and disabled ids", async () => {
  const chatState = {
    _id: "chat_1",
    userId: "user_1",
    discoverableSkillIds: ["skill_1"],
    disabledSkillIds: ["skill_2"],
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
    discoverableSkillIds: ["skill_1", "skill_2"],
    disabledSkillIds: [],
  });

  chatState.discoverableSkillIds = ["skill_1", "skill_2"];
  chatState.disabledSkillIds = [];
  const disabled = await disableSkillForChat.execute(ctx, {
    chatId: "chat_1",
    skillSlug: "sheets",
  });
  assert.equal(disabled.success, true);
  assert.deepEqual(mutations[1], {
    chatId: "chat_1",
    userId: "user_1",
    disabledSkillIds: ["skill_2"],
    discoverableSkillIds: ["skill_1"],
  });
});

test("assignSkillToPersona and removeSkillFromPersona resolve personas and manage discoverable skills", async () => {
  const personas = [
    { _id: "persona_1", displayName: "Researcher", discoverableSkillIds: [] },
    { _id: "persona_2", displayName: "Research Assistant", discoverableSkillIds: [] },
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
      if (args.userId) return [{ _id: "persona_1", displayName: "Researcher", discoverableSkillIds: [] }];
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
    discoverableSkillIds: ["skill_1"],
  });

  const removeCtx = createToolCtx({
    runQuery: async (args) => {
      if (args.slug) return { _id: "skill_1", name: "Research Skill" };
      if (args.userId) {
        return [{ _id: "persona_1", displayName: "Researcher", discoverableSkillIds: ["skill_1", "skill_2"] }];
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
    discoverableSkillIds: ["skill_2"],
  });
});
