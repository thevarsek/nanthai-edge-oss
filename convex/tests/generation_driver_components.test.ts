import assert from "node:assert/strict";
import test from "node:test";

import {
  findActiveGenerationDriver,
  isGenerationDriverRole,
} from "../chat/generation_driver_components";

const driverRoles = [
  "generation-workflow",
  "generation-workflow-primary",
  "generation-workflow-continuation:24",
  "generation-workflow-recovery:workflow_1",
  "video-generation-workflow",
];

test("every current generation owner role is recognized as a driver", () => {
  for (const role of driverRoles) assert.equal(isGenerationDriverRole(role), true, role);
  assert.equal(isGenerationDriverRole("video-provider-reconciliation"), false);
  assert.equal(isGenerationDriverRole("presentation-workflow"), false);
});

test("active continuation, recovery, and video drivers block a competing primary", async () => {
  for (const role of driverRoles.slice(2)) {
    const ref = { _id: `ref:${role}`, role, status: "active" };
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({ collect: async () => [ref] }),
        }),
      },
    };
    assert.equal(
      await findActiveGenerationDriver(ctx as never, "run_1" as never),
      ref,
      role,
    );
  }
});

test("cancel-requested drivers still own dispatch until quiescence", async () => {
  const ref = {
    _id: "ref_cancel_requested",
    role: "generation-workflow-continuation:48",
    status: "cancel_requested",
  };
  let queryCount = 0;
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => (++queryCount === 1 ? [] : [ref]),
        }),
      }),
    },
  };
  assert.equal(
    await findActiveGenerationDriver(ctx as never, "run_1" as never),
    ref,
  );
});
