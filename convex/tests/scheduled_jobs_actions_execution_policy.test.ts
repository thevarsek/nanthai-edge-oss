import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldExecuteScheduledJob,
  shouldReplaceExistingSchedule,
} from "../scheduledJobs/actions_execution_policy.ts";

test("scheduled invocations only run active jobs", () => {
  assert.equal(
    shouldExecuteScheduledJob({
      status: "active",
      recurrence: { type: "daily", hourUTC: 8, minuteUTC: 30 },
      invocationSource: "scheduled",
    }),
    true,
  );

  assert.equal(
    shouldExecuteScheduledJob({
      status: "paused",
      recurrence: { type: "daily", hourUTC: 8, minuteUTC: 30 },
      invocationSource: "scheduled",
    }),
    false,
  );
});

test("manual invocations allow paused non-manual jobs but not paused manual jobs", () => {
  assert.equal(
    shouldExecuteScheduledJob({
      status: "paused",
      recurrence: { type: "interval", minutes: 60 },
      invocationSource: "manual",
    }),
    true,
  );

  assert.equal(
    shouldExecuteScheduledJob({
      status: "paused",
      recurrence: { type: "manual" },
      invocationSource: "manual",
    }),
    false,
  );
});

test("only manual runs replace an existing scheduled function", () => {
  assert.equal(
    shouldReplaceExistingSchedule({
      status: "active",
      invocationSource: "manual",
    }),
    true,
  );

  assert.equal(
    shouldReplaceExistingSchedule({
      status: "active",
      invocationSource: "scheduled",
    }),
    false,
  );
});
