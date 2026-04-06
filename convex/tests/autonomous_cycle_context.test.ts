import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import { resolveLinearCycleParentIds } from "../autonomous/actions_run_cycle_context";

test("resolveLinearCycleParentIds returns empty when no parents are present", () => {
  const result = resolveLinearCycleParentIds([]);
  assert.deepEqual(result, []);
});

test("resolveLinearCycleParentIds keeps only the primary parent for linear turns", () => {
  const parentA = "m1" as unknown as Id<"messages">;
  const parentB = "m2" as unknown as Id<"messages">;
  const parentC = "m3" as unknown as Id<"messages">;

  const result = resolveLinearCycleParentIds([parentA, parentB, parentC]);
  assert.deepEqual(result, [parentA]);
});
