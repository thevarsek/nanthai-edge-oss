import assert from "node:assert/strict";
import test from "node:test";
import { executionParallelism } from "../execution/components";

test("execution pools use the Starter S16 launch profile", () => {
  assert.deepEqual(executionParallelism, {
    workflow: 10,
    interactive: 6,
    background: 3,
    maintenance: 1,
  });
  assert.equal(Object.values(executionParallelism).reduce((sum, value) => sum + value, 0), 20);
  assert.ok(executionParallelism.workflow > executionParallelism.interactive);
  assert.ok(executionParallelism.interactive > executionParallelism.background);
  assert.ok(executionParallelism.background > executionParallelism.maintenance);
});
