import type { Recurrence } from "../scheduledJobs/recurrence";

/**
 * Project the model-authored tool payload onto the strict Convex recurrence
 * union. Tool schemas cannot express a discriminated union reliably across
 * every model provider, so unused optional fields may arrive with defaults.
 */
export function normalizeToolRecurrence(value: unknown): Recurrence | undefined {
  if (!value || typeof value !== "object") return undefined;

  const recurrence = value as Record<string, unknown>;
  switch (recurrence.type) {
    case "interval":
      return typeof recurrence.minutes === "number"
        ? { type: "interval", minutes: recurrence.minutes }
        : undefined;
    case "daily":
      return typeof recurrence.hourUTC === "number"
        && typeof recurrence.minuteUTC === "number"
        ? {
            type: "daily",
            hourUTC: recurrence.hourUTC,
            minuteUTC: recurrence.minuteUTC,
          }
        : undefined;
    case "weekly":
      return typeof recurrence.dayOfWeek === "number"
        && typeof recurrence.hourUTC === "number"
        && typeof recurrence.minuteUTC === "number"
        ? {
            type: "weekly",
            dayOfWeek: recurrence.dayOfWeek,
            hourUTC: recurrence.hourUTC,
            minuteUTC: recurrence.minuteUTC,
          }
        : undefined;
    case "cron":
      return typeof recurrence.expression === "string"
        ? { type: "cron", expression: recurrence.expression }
        : undefined;
    case "manual":
      return { type: "manual" };
    default:
      return undefined;
  }
}
