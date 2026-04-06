import assert from "node:assert/strict";
import test from "node:test";

import {
  computeNextRunTime,
  validateRecurrence,
  parseCronNext,
} from "../scheduledJobs/recurrence";
import type { Recurrence } from "../scheduledJobs/recurrence";

// ── computeNextRunTime ────────────────────────────────────────────────

test("manual recurrence returns null", () => {
  const result = computeNextRunTime({ type: "manual" });
  assert.equal(result, null);
});

test("interval recurrence returns now + minutes*60000", () => {
  const before = Date.now();
  const result = computeNextRunTime({ type: "interval", minutes: 30 });
  const after = Date.now();

  assert.notEqual(result, null);
  // Should be ~30 minutes from now, within 100ms tolerance
  assert.ok(result! >= before + 30 * 60_000);
  assert.ok(result! <= after + 30 * 60_000);
});

test("daily recurrence returns a time in the future", () => {
  const result = computeNextRunTime({
    type: "daily",
    hourUTC: 14,
    minuteUTC: 30,
  });
  assert.notEqual(result, null);
  assert.ok(result! > Date.now());

  // The result should be at 14:30 UTC
  const d = new Date(result!);
  assert.equal(d.getUTCHours(), 14);
  assert.equal(d.getUTCMinutes(), 30);
  assert.equal(d.getUTCSeconds(), 0);
});

test("daily recurrence rolls to tomorrow if time has passed today", () => {
  // Use a time that's definitely in the past today (00:00 UTC)
  const now = new Date();
  // Only run this assertion if current UTC time is past 00:01
  if (now.getUTCHours() > 0 || now.getUTCMinutes() > 1) {
    const result = computeNextRunTime({
      type: "daily",
      hourUTC: 0,
      minuteUTC: 0,
    });
    assert.notEqual(result, null);
    const d = new Date(result!);
    // Should be tomorrow
    assert.ok(d.getUTCDate() !== now.getUTCDate() || d.getUTCMonth() !== now.getUTCMonth());
  }
});

test("weekly recurrence returns correct day of week", () => {
  // Schedule for Wednesday (3) at 10:00 UTC
  const result = computeNextRunTime({
    type: "weekly",
    dayOfWeek: 3,
    hourUTC: 10,
    minuteUTC: 0,
  });
  assert.notEqual(result, null);
  const d = new Date(result!);
  assert.equal(d.getUTCDay(), 3); // Wednesday
  assert.equal(d.getUTCHours(), 10);
  assert.equal(d.getUTCMinutes(), 0);
});

test("weekly recurrence is always in the future", () => {
  for (let day = 0; day <= 6; day++) {
    const result = computeNextRunTime({
      type: "weekly",
      dayOfWeek: day,
      hourUTC: 12,
      minuteUTC: 0,
    });
    assert.notEqual(result, null);
    assert.ok(result! > Date.now());
  }
});

test("cron recurrence delegates to parseCronNext", () => {
  // "0 12 * * *" = every day at 12:00 UTC
  const result = computeNextRunTime({
    type: "cron",
    expression: "0 12 * * *",
  });
  assert.notEqual(result, null);
  assert.ok(result! > Date.now());
  const d = new Date(result!);
  assert.equal(d.getUTCHours(), 12);
  assert.equal(d.getUTCMinutes(), 0);
});

test("cron with invalid expression returns null", () => {
  const result = computeNextRunTime({
    type: "cron",
    expression: "not a cron",
  });
  assert.equal(result, null);
});

// ── validateRecurrence ────────────────────────────────────────────────

test("validates manual as always valid", () => {
  assert.equal(validateRecurrence({ type: "manual" }), null);
});

test("validates interval rejects below 15 minutes", () => {
  const err = validateRecurrence({ type: "interval", minutes: 5 });
  assert.ok(err !== null);
  assert.ok(err!.includes("15 minutes"));
});

test("validates interval accepts 15 minutes", () => {
  assert.equal(validateRecurrence({ type: "interval", minutes: 15 }), null);
});

test("validates interval accepts 60 minutes", () => {
  assert.equal(validateRecurrence({ type: "interval", minutes: 60 }), null);
});

test("validates interval rejects non-integer", () => {
  const err = validateRecurrence({ type: "interval", minutes: 30.5 });
  assert.ok(err !== null);
});

test("validates interval rejects zero", () => {
  const err = validateRecurrence({ type: "interval", minutes: 0 });
  assert.ok(err !== null);
});

test("validates interval rejects negative", () => {
  const err = validateRecurrence({ type: "interval", minutes: -10 });
  assert.ok(err !== null);
});

test("validates daily rejects out-of-range hour", () => {
  assert.ok(
    validateRecurrence({ type: "daily", hourUTC: 24, minuteUTC: 0 }) !== null,
  );
  assert.ok(
    validateRecurrence({ type: "daily", hourUTC: -1, minuteUTC: 0 }) !== null,
  );
});

test("validates daily rejects out-of-range minute", () => {
  assert.ok(
    validateRecurrence({ type: "daily", hourUTC: 0, minuteUTC: 60 }) !== null,
  );
  assert.ok(
    validateRecurrence({ type: "daily", hourUTC: 0, minuteUTC: -1 }) !== null,
  );
});

test("validates daily accepts valid times", () => {
  assert.equal(
    validateRecurrence({ type: "daily", hourUTC: 0, minuteUTC: 0 }),
    null,
  );
  assert.equal(
    validateRecurrence({ type: "daily", hourUTC: 23, minuteUTC: 59 }),
    null,
  );
});

test("validates weekly rejects invalid dayOfWeek", () => {
  assert.ok(
    validateRecurrence({
      type: "weekly",
      dayOfWeek: 7,
      hourUTC: 0,
      minuteUTC: 0,
    }) !== null,
  );
  assert.ok(
    validateRecurrence({
      type: "weekly",
      dayOfWeek: -1,
      hourUTC: 0,
      minuteUTC: 0,
    }) !== null,
  );
});

test("validates weekly accepts valid values", () => {
  for (let day = 0; day <= 6; day++) {
    assert.equal(
      validateRecurrence({
        type: "weekly",
        dayOfWeek: day,
        hourUTC: 12,
        minuteUTC: 0,
      }),
      null,
    );
  }
});

test("validates cron rejects invalid expressions", () => {
  assert.ok(
    validateRecurrence({ type: "cron", expression: "bad" }) !== null,
  );
  assert.ok(
    validateRecurrence({ type: "cron", expression: "* * * *" }) !== null,
  ); // only 4 fields
});

test("validates cron rejects too-frequent expressions", () => {
  // "* * * * *" fires every minute — way below 15-minute minimum
  const err = validateRecurrence({ type: "cron", expression: "* * * * *" });
  assert.ok(err !== null);
  assert.ok(err!.includes("15 minutes"));
});

test("validates cron accepts standard hourly", () => {
  assert.equal(
    validateRecurrence({ type: "cron", expression: "0 * * * *" }),
    null,
  );
});

test("validates cron accepts daily at midnight", () => {
  assert.equal(
    validateRecurrence({ type: "cron", expression: "0 0 * * *" }),
    null,
  );
});

// ── parseCronNext ─────────────────────────────────────────────────────

test("parseCronNext handles every-hour cron", () => {
  // "0 * * * *" — top of every hour
  const base = new Date("2026-03-05T10:00:00Z").getTime();
  const next = parseCronNext("0 * * * *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCHours(), 11);
  assert.equal(d.getUTCMinutes(), 0);
});

test("parseCronNext handles specific minute and hour", () => {
  const base = new Date("2026-03-05T10:00:00Z").getTime();
  const next = parseCronNext("30 14 * * *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCHours(), 14);
  assert.equal(d.getUTCMinutes(), 30);
});

test("parseCronNext handles day-of-week filter", () => {
  // "0 12 * * 1" — Monday at noon
  const base = new Date("2026-03-05T10:00:00Z").getTime(); // Thursday
  const next = parseCronNext("0 12 * * 1", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCDay(), 1); // Monday
  assert.equal(d.getUTCHours(), 12);
});

test("parseCronNext handles ranges", () => {
  // "0 9-17 * * *" — every hour 9-17
  const base = new Date("2026-03-05T16:30:00Z").getTime();
  const next = parseCronNext("0 9-17 * * *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCHours(), 17);
  assert.equal(d.getUTCMinutes(), 0);
});

test("parseCronNext handles lists", () => {
  // "0 6,12,18 * * *" — 3 times a day
  const base = new Date("2026-03-05T06:30:00Z").getTime();
  const next = parseCronNext("0 6,12,18 * * *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCHours(), 12);
});

test("parseCronNext handles steps", () => {
  // "*/15 * * * *" — every 15 minutes
  const base = new Date("2026-03-05T10:02:00Z").getTime();
  const next = parseCronNext("*/15 * * * *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  // Next 15-min slot after 10:02 is 10:15
  assert.equal(d.getUTCMinutes(), 15);
});

test("parseCronNext handles month filter", () => {
  // "0 0 1 6 *" — June 1st midnight
  const base = new Date("2026-03-05T10:00:00Z").getTime();
  const next = parseCronNext("0 0 1 6 *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCMonth(), 5); // June (0-indexed)
  assert.equal(d.getUTCDate(), 1);
});

test("parseCronNext returns null for invalid expression", () => {
  assert.equal(parseCronNext("invalid cron", Date.now()), null);
  assert.equal(parseCronNext("70 * * * *", Date.now()), null); // minute > 59
  assert.equal(parseCronNext("* 25 * * *", Date.now()), null); // hour > 23
});

test("parseCronNext returns null for too few fields", () => {
  assert.equal(parseCronNext("0 * * *", Date.now()), null);
});

test("parseCronNext returns null for too many fields", () => {
  assert.equal(parseCronNext("0 * * * * *", Date.now()), null);
});

test("parseCronNext consecutive calls produce ordered results", () => {
  // Two consecutive next-runs should be ordered
  const first = parseCronNext("0 * * * *", Date.now());
  assert.notEqual(first, null);
  const second = parseCronNext("0 * * * *", first!);
  assert.notEqual(second, null);
  assert.ok(second! > first!);
  // Interval should be ~1 hour
  assert.ok(Math.abs(second! - first! - 3_600_000) < 1000);
});

test("parseCronNext uses OR semantics when both DOM and DOW are restricted", () => {
  // "0 12 15 * 1" — noon on the 15th OR on Mondays (standard cron OR rule)
  // 2026-03-05 is a Thursday. Next Monday is 2026-03-09, 15th is 2026-03-15.
  // With OR semantics the 9th (Monday) should come first.
  const base = new Date("2026-03-05T10:00:00Z").getTime();
  const next = parseCronNext("0 12 15 * 1", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  // Should match Monday Mar 9 (day=1), not wait for the 15th
  assert.equal(d.getUTCDay(), 1); // Monday
  assert.equal(d.getUTCDate(), 9);
  assert.equal(d.getUTCHours(), 12);
});

test("parseCronNext uses AND semantics when only DOM is restricted", () => {
  // "0 12 15 * *" — noon on the 15th of every month (DOW is *, so AND)
  const base = new Date("2026-03-05T10:00:00Z").getTime();
  const next = parseCronNext("0 12 15 * *", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCDate(), 15);
  assert.equal(d.getUTCHours(), 12);
});

test("parseCronNext uses AND semantics when only DOW is restricted", () => {
  // "0 12 * * 5" — noon every Friday (DOM is *, so AND)
  const base = new Date("2026-03-05T10:00:00Z").getTime(); // Thursday
  const next = parseCronNext("0 12 * * 5", base);
  assert.notEqual(next, null);
  const d = new Date(next!);
  assert.equal(d.getUTCDay(), 5); // Friday
  assert.equal(d.getUTCHours(), 12);
});
