import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  archiveSkill,
  createSkillInternal,
  duplicateSystemSkillInternal,
  setChatSkillsPublic,
  updateSkill,
  updateSkillInternal,
} from "../skills/mutations";

function buildAuth(userId = "user_1") {
  return { getUserIdentity: async () => ({ subject: userId }) };
}

function queryFor(options: {
  bySlug?: unknown[];
  byOwner?: unknown[];
  entitlement?: unknown;
} = {}) {
  return {
    withIndex: (index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return {
        first: async () => options.entitlement ?? null,
        collect: async () => {
          if (index === "by_slug") return options.bySlug ?? [];
          if (index === "by_owner") return options.byOwner ?? [];
          return [];
        },
      };
    },
  };
}

const baseSkill = {
  _id: "skill_1",
  ownerUserId: "user_1",
  slug: "writer",
  name: "Writer",
  instructionsRaw: "Write concise responses using only the current conversation context.",
  runtimeMode: "textOnly",
  requiredToolIds: [],
  requiredToolProfiles: [],
  requiredIntegrationIds: [],
  requiredCapabilities: [],
  lockState: "editable",
  version: 1,
};

test("skill validation rejects reachable browser and MCP runtime references with actionable metadata", async () => {
  await assert.rejects(
    (createSkillInternal as any)._handler({
      db: { query: () => queryFor() },
    }, {
      userId: "user_1",
      name: "Browser Runner",
      summary: "Runs desktop flows",
      instructionsRaw: "Use Playwright browser automation, take screenshots, and start an MCP server before responding.",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      assert.equal(error.data?.code, "SKILL_INCOMPATIBLE");
      assert.deepEqual(error.data?.codes, ["USES_BROWSER", "USES_MCP"]);
      assert.match(String(error.data?.message), /browser automation/i);
      assert.match(String(error.data?.message), /MCP servers/i);
      return true;
    },
  );
});

test("internal skill update patches same-slug metadata without duplicate slug checks", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const result = await (updateSkillInternal as any)._handler({
    db: {
      get: async () => baseSkill,
      query: () => queryFor(),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, {
    skillId: "skill_1",
    userId: "user_1",
    name: " Writer ",
    summary: " Updated summary ",
    requiredIntegrationIds: ["gmail"],
    requiredCapabilities: ["pro"],
  });

  assert.deepEqual(result, { skillId: "skill_1", validationWarnings: [] });
  assert.equal(patches[0]?.value.name, "Writer");
  assert.equal(patches[0]?.value.slug, "writer");
  assert.equal(patches[0]?.value.summary, "Updated summary");
  assert.deepEqual(patches[0]?.value.requiredIntegrationIds, ["gmail"]);
  assert.deepEqual(patches[0]?.value.requiredCapabilities, ["pro"]);
  assert.equal(patches[0]?.value.version, 2);
});

test("duplicating system skills increments custom suffixes until a user slug is free", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const newId = await (duplicateSystemSkillInternal as any)._handler({
    db: {
      get: async () => ({
        _id: "system_skill",
        scope: "system",
        slug: "researcher",
        name: "Researcher",
        summary: "Research",
        instructionsRaw: "Research with care.",
        compilationStatus: "compiled",
        runtimeMode: "textOnly",
        requiredToolIds: [],
        requiredIntegrationIds: [],
      }),
      query: () => queryFor({
        byOwner: [
          { _id: "skill_custom_1", slug: "researcher-custom" },
          { _id: "skill_custom_2", slug: "researcher-custom-2" },
        ],
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "skill_copy";
      },
    },
  }, { skillId: "system_skill", userId: "user_1" });

  assert.equal(newId, "skill_copy");
  assert.equal(inserts[0]?.slug, "researcher-custom-3");
  assert.equal(inserts[0]?.name, "Researcher (Custom 3)");
});

test("public skill update, archive, and chat assignment mutations enforce pro auth and patch owned rows", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "skill_1") return baseSkill;
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            skillOverrides: [{ skillId: "skill_old", state: "always" }],
          };
        }
        return null;
      },
      query: (table: string) => queryFor({
        entitlement: table === "purchaseEntitlements"
          ? { _id: "ent_1", status: "active" }
          : null,
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as any;

  await (updateSkill as any)._handler(ctx, {
    skillId: "skill_1",
    summary: " Public summary ",
    requiredToolIds: ["generate_docx"],
  });
  await (archiveSkill as any)._handler(ctx, { skillId: "skill_1" });
  await (setChatSkillsPublic as any)._handler(ctx, {
    chatId: "chat_1",
    discoverableSkillIds: ["skill_new"],
    disabledSkillIds: ["skill_old"],
  });

  assert.equal(patches[0]?.value.summary, "Public summary");
  assert.deepEqual(patches[0]?.value.requiredToolIds, ["generate_docx"]);
  assert.equal(patches[1]?.value.status, "archived");
  assert.deepEqual(patches[2]?.value.skillOverrides, [
    { skillId: "skill_old", state: "never" },
    { skillId: "skill_new", state: "available" },
  ]);
});
