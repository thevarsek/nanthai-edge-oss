import assert from "node:assert/strict";
import test from "node:test";

import { normalizeToolRecurrence } from "../tools/scheduled_jobs_recurrence";

const unusedFields = {
  minutes: 0,
  hourUTC: 0,
  minuteUTC: 0,
  dayOfWeek: 0,
  expression: "unused",
  ignored: true,
};

test("normalizeToolRecurrence strips fields outside each strict union member", () => {
  assert.deepEqual(
    normalizeToolRecurrence({
      ...unusedFields,
      type: "interval",
      minutes: 30,
    }),
    { type: "interval", minutes: 30 },
  );
  assert.deepEqual(
    normalizeToolRecurrence({
      ...unusedFields,
      type: "daily",
      hourUTC: 8,
      minuteUTC: 15,
    }),
    { type: "daily", hourUTC: 8, minuteUTC: 15 },
  );
  assert.deepEqual(
    normalizeToolRecurrence({
      ...unusedFields,
      type: "weekly",
      dayOfWeek: 1,
      hourUTC: 9,
      minuteUTC: 45,
    }),
    { type: "weekly", dayOfWeek: 1, hourUTC: 9, minuteUTC: 45 },
  );
  assert.deepEqual(
    normalizeToolRecurrence({
      ...unusedFields,
      type: "cron",
      expression: "*/15 * * * *",
    }),
    { type: "cron", expression: "*/15 * * * *" },
  );
  assert.deepEqual(
    normalizeToolRecurrence({
      ...unusedFields,
      type: "manual",
    }),
    { type: "manual" },
  );
});

test("normalizeToolRecurrence rejects missing discriminators and required fields", () => {
  assert.equal(normalizeToolRecurrence(null), undefined);
  assert.equal(normalizeToolRecurrence({}), undefined);
  assert.equal(normalizeToolRecurrence({ type: "interval" }), undefined);
  assert.equal(normalizeToolRecurrence({ type: "daily", hourUTC: 8 }), undefined);
  assert.equal(normalizeToolRecurrence({ type: "weekly", hourUTC: 8, minuteUTC: 0 }), undefined);
  assert.equal(normalizeToolRecurrence({ type: "cron" }), undefined);
  assert.equal(normalizeToolRecurrence({ type: "yearly" }), undefined);
});
