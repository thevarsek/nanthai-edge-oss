import assert from "node:assert/strict";
import test from "node:test";
import { REMOVED_SYSTEM_SKILL_SLUGS } from "../skills/catalog";
import { cleanupLegacyAdvisorSkillProfilePage } from "../skills/mutations_seed_cleanup";
import { availableProgressiveProfiles } from "../tools/progressive_registry_shared";

const cleanupHandler = (cleanupLegacyAdvisorSkillProfilePage as unknown as {
  _handler: (
    ctx: unknown,
    args: { cursor?: string },
  ) => Promise<{ continueCursor: string; isDone: boolean; patchedCount: number }>;
})._handler;

test("legacy Advisor Skill is removed and cannot activate a progressive profile", async () => {
  assert.ok(REMOVED_SYSTEM_SKILL_SLUGS.includes("openrouter-advisor"));
  assert.equal(
    availableProgressiveProfiles({ isPro: true }).some((profile) => String(profile) === "advisor"),
    false,
  );

  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const result = await cleanupHandler({
    db: {
      query: () => ({
        paginate: async () => ({
          page: [
            { _id: "skill_1", requiredToolProfiles: ["docs", "advisor"] },
            { _id: "skill_2", requiredToolProfiles: ["workspace"] },
          ],
          continueCursor: "done",
          isDone: true,
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  }, {});
  assert.equal(result.isDone, true);
  assert.equal(result.patchedCount, 1);
  assert.deepEqual(patches[0]?.patch.requiredToolProfiles, ["docs"]);
});
