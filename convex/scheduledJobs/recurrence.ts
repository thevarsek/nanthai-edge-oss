// convex/scheduledJobs/recurrence.ts
// =============================================================================
// Recurrence calculator — computes the next run time for a scheduled job.
// =============================================================================

/** Recurrence type discriminated union (mirrors schema validator shape). */
export type Recurrence =
  | { type: "interval"; minutes: number }
  | { type: "daily"; hourUTC: number; minuteUTC: number }
  | { type: "weekly"; dayOfWeek: number; hourUTC: number; minuteUTC: number }
  | { type: "cron"; expression: string }
  | { type: "manual" };

/**
 * Compute the next execution time in epoch milliseconds.
 * Returns `null` for manual recurrence (no automatic scheduling).
 */
export function computeNextRunTime(
  recurrence: Recurrence,
  _timezone?: string,
): number | null {
  const now = Date.now();

  switch (recurrence.type) {
    case "manual":
      return null;

    case "interval":
      return now + recurrence.minutes * 60 * 1000;

    case "daily": {
      const next = new Date();
      next.setUTCHours(recurrence.hourUTC, recurrence.minuteUTC, 0, 0);
      if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
      return next.getTime();
    }

    case "weekly": {
      const next = new Date();
      next.setUTCHours(recurrence.hourUTC, recurrence.minuteUTC, 0, 0);
      const currentDay = next.getUTCDay();
      let daysUntil = recurrence.dayOfWeek - currentDay;
      if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= now)) {
        daysUntil += 7;
      }
      next.setUTCDate(next.getUTCDate() + daysUntil);
      return next.getTime();
    }

    case "cron":
      return parseCronNext(recurrence.expression, now);
  }
}

// ── Validation ─────────────────────────────────────────────────────────

const MIN_INTERVAL_MINUTES = 15;

/**
 * Validate a recurrence object. Returns an error string or null if valid.
 */
export function validateRecurrence(recurrence: Recurrence): string | null {
  switch (recurrence.type) {
    case "manual":
      return null;

    case "interval":
      if (recurrence.minutes < MIN_INTERVAL_MINUTES) {
        return `Minimum interval is ${MIN_INTERVAL_MINUTES} minutes`;
      }
      if (!Number.isInteger(recurrence.minutes) || recurrence.minutes <= 0) {
        return "Interval minutes must be a positive integer";
      }
      return null;

    case "daily":
      if (recurrence.hourUTC < 0 || recurrence.hourUTC > 23) {
        return "Hour must be 0–23";
      }
      if (recurrence.minuteUTC < 0 || recurrence.minuteUTC > 59) {
        return "Minute must be 0–59";
      }
      return null;

    case "weekly":
      if (recurrence.dayOfWeek < 0 || recurrence.dayOfWeek > 6) {
        return "Day of week must be 0 (Sunday) to 6 (Saturday)";
      }
      if (recurrence.hourUTC < 0 || recurrence.hourUTC > 23) {
        return "Hour must be 0–23";
      }
      if (recurrence.minuteUTC < 0 || recurrence.minuteUTC > 59) {
        return "Minute must be 0–59";
      }
      return null;

    case "cron": {
      const err = validateCronExpression(recurrence.expression);
      if (err) return err;
      // Check effective interval is >= 15 minutes
      const next1 = parseCronNext(recurrence.expression, Date.now());
      if (next1 === null) return "Could not compute next run from cron expression";
      const next2 = parseCronNext(recurrence.expression, next1);
      if (next2 !== null && next2 - next1 < MIN_INTERVAL_MINUTES * 60 * 1000) {
        return `Effective cron interval must be at least ${MIN_INTERVAL_MINUTES} minutes`;
      }
      return null;
    }
  }
}

// ── Lightweight cron parser (5-field standard) ─────────────────────────

/**
 * Parse a 5-field cron expression and find the next occurrence after `after` (ms).
 * Fields: minute hour dayOfMonth month dayOfWeek
 * Supports: numbers, ranges (1-5), steps (star/N), lists (1,3,5), star.
 * Returns epoch ms or null on failure.
 */
export function parseCronNext(expression: string, after: number): number | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minuteSet = parseField(parts[0], 0, 59);
  const hourSet = parseField(parts[1], 0, 23);
  const domSet = parseField(parts[2], 1, 31);
  const monthSet = parseField(parts[3], 1, 12);
  const dowSet = parseField(parts[4], 0, 6);

  if (!minuteSet || !hourSet || !domSet || !monthSet || !dowSet) return null;

  // Standard cron semantics: if BOTH day-of-month and day-of-week are
  // restricted (not wildcard / full-range), they combine with OR (run when
  // either matches). If only one is restricted, use AND (the unrestricted
  // one always matches so OR/AND are equivalent). We detect "unrestricted"
  // by checking if the parsed set covers every value in [min..max].
  const domIsWild = domSet.size === 31; // 1-31
  const dowIsWild = dowSet.size === 7; // 0-6
  const useDayOr = !domIsWild && !dowIsWild;

  // Walk forward from `after` to find the next match.
  // Horizon: 366 days — sufficient for all sub-yearly schedules.
  // Very infrequent crons (e.g. yearly Feb 29) may return null; callers
  // should treat null as "unable to compute" rather than "invalid".
  const start = new Date(after + 60_000); // Start from next minute
  start.setUTCSeconds(0, 0);

  const limit = after + 366 * 24 * 60 * 60 * 1000;

  const d = new Date(start);
  while (d.getTime() < limit) {
    if (!monthSet.has(d.getUTCMonth() + 1)) {
      // Skip to next month
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    // Day matching: OR when both DOM and DOW are restricted, AND otherwise.
    const domMatch = domSet.has(d.getUTCDate());
    const dowMatch = dowSet.has(d.getUTCDay());
    const dayMatch = useDayOr ? (domMatch || dowMatch) : (domMatch && dowMatch);
    if (!dayMatch) {
      // Skip to next day
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!hourSet.has(d.getUTCHours())) {
      // Skip to next hour
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minuteSet.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return d.getTime();
  }

  return null; // No match within 366-day horizon
}

function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range: string;
    let step = 1;

    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
      if (step <= 0) return null;
    } else {
      range = part;
    }

    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else {
      const rangeMatch = range.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < min || end > max || start > end) return null;
        for (let i = start; i <= end; i += step) values.add(i);
      } else {
        const val = parseInt(range, 10);
        if (isNaN(val) || val < min || val > max) return null;
        values.add(val);
      }
    }
  }

  return values.size > 0 ? values : null;
}

function validateCronExpression(expression: string): string | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "Cron expression must have exactly 5 fields";

  const checks: [string, number, number, string][] = [
    [parts[0], 0, 59, "minute"],
    [parts[1], 0, 23, "hour"],
    [parts[2], 1, 31, "day of month"],
    [parts[3], 1, 12, "month"],
    [parts[4], 0, 6, "day of week"],
  ];

  for (const [field, min, max, name] of checks) {
    const result = parseField(field, min, max);
    if (!result) return `Invalid ${name} field: "${field}"`;
  }

  return null;
}
