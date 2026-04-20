import assert from "node:assert/strict";
import test from "node:test";

import {
  listVisibleSkills,
  listDiscoverableSkills,
  listVisibleSkillsInternal,
  listActiveSystemSkills,
} from "../skills/queries";

// =============================================================================
// Helpers
// =============================================================================

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () =>
      userId ? { subject: userId, email: "u@test.com" } : null,
  };
}

let idCounter = 0;
function makeSkillRow(overrides: Partial<Record<string, unknown>> = {}): any {
  idCounter += 1;
  return {
    _id: overrides._id ?? `skill_${idCounter}`,
    slug: `skill-${idCounter}`,
    name: `Skill ${idCounter}`,
    summary: `Summary ${idCounter}`,
    scope: "system",
    visibility: "visible",
    status: "active",
    ownerUserId: undefined,
    requiredCapabilities: [],
    ...overrides,
  };
}

/**
 * Build a mock QueryCtx with controllable skill rows.
 */
function buildCtx(
  systemSkills: any[],
  userSkills: any[],
  userId = "user_1",
  capabilities: any[] = [],
) {
  return {
    auth: buildAuth(userId),
    db: {
      query: (table: string) => ({
        withIndex: (_indexName: string, _fn?: any) => {
          // Determine which dataset to return based on the index
          if (table === "skills") {
            // The index callback is called with a query builder — we just return data
            return {
              collect: async () => {
                // Heuristic: by_scope returns system, by_owner returns user
                const indexStr = _indexName;
                if (indexStr === "by_scope") return systemSkills;
                if (indexStr === "by_owner") return userSkills;
                return [];
              },
              first: async () => null,
            };
          }
          if (table === "userCapabilities") {
            return {
              collect: async () => capabilities,
            };
          }
          return {
            collect: async () => [],
            first: async () => null,
          };
        },
      }),
      get: async (id: string) => {
        return [...systemSkills, ...userSkills].find((s) => s._id === id) ?? null;
      },
    },
  };
}

// =============================================================================
// MARK: User-facing queries exclude integration_managed
// =============================================================================

test("listVisibleSkills: excludes integration_managed skills", async () => {
  const visible = makeSkillRow({ visibility: "visible" });
  const managed = makeSkillRow({ visibility: "integration_managed" });
  const hidden = makeSkillRow({ visibility: "hidden" });

  const ctx = buildCtx([visible, managed, hidden], []);
  const result = await (listVisibleSkills as any)._handler(ctx, {});

  assert.equal(result.length, 1);
  assert.equal(result[0]._id, visible._id);
});

test("listDiscoverableSkills: excludes integration_managed skills", async () => {
  const visible = makeSkillRow({ visibility: "visible" });
  const managed = makeSkillRow({ visibility: "integration_managed" });

  const ctx = buildCtx([visible, managed], []);
  const result = await (listDiscoverableSkills as any)._handler(ctx, {});

  assert.equal(result.length, 1);
  assert.equal(result[0]._id, visible._id);
});

// =============================================================================
// MARK: Internal queries include integration_managed
// =============================================================================

test("listVisibleSkillsInternal: includes integration_managed skills", async () => {
  const visible = makeSkillRow({ visibility: "visible" });
  const managed = makeSkillRow({ visibility: "integration_managed" });
  const hidden = makeSkillRow({ visibility: "hidden" });

  const ctx = buildCtx([visible, managed, hidden], []);
  const result = await (listVisibleSkillsInternal as any)._handler(ctx, {
    userId: "user_1",
  });

  assert.equal(result.length, 2);
  const ids = result.map((s: any) => s._id);
  assert.ok(ids.includes(visible._id));
  assert.ok(ids.includes(managed._id));
  assert.ok(!ids.includes(hidden._id));
});

test("listActiveSystemSkills: returns all active system skills including integration_managed", async () => {
  const visible = makeSkillRow({ visibility: "visible" });
  const managed = makeSkillRow({ visibility: "integration_managed" });
  const hidden = makeSkillRow({ visibility: "hidden" });

  const ctx = buildCtx([visible, managed, hidden], []);
  const result = await (listActiveSystemSkills as any)._handler(ctx, {});

  // listActiveSystemSkills doesn't filter by visibility at all — returns everything
  assert.equal(result.length, 3);
});

// =============================================================================
// MARK: User skills are always included regardless of visibility
// =============================================================================

test("listVisibleSkills: includes user-owned visible skills", async () => {
  const userSkill = makeSkillRow({
    scope: "user",
    visibility: "visible",
    ownerUserId: "user_1",
  });

  const ctx = buildCtx([], [userSkill]);
  const result = await (listVisibleSkills as any)._handler(ctx, {});

  assert.equal(result.length, 1);
});

test("listVisibleSkills: unauthenticated returns empty", async () => {
  const ctx = {
    auth: buildAuth(null),
    db: buildCtx([], []).db,
  };
  const result = await (listVisibleSkills as any)._handler(ctx, {});
  assert.deepEqual(result, []);
});
