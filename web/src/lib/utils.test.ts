import { describe, expect, it } from "vitest";
import { formatTimestamp, getTimeGroup } from "./utils";

describe("date helpers", () => {
  it("formats same-calendar-day timestamps as a local time and groups them as today", () => {
    const now = new Date(2026, 5, 2, 16, 45).getTime();
    const timestamp = new Date(2026, 5, 2, 8, 5).getTime();

    expect(formatTimestamp(timestamp, now)).toBe(
      new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
    expect(getTimeGroup(timestamp, now)).toBe("Today");
  });

  it("classifies a previous-calendar-day timestamp as yesterday even when it is under 24 hours old", () => {
    const now = new Date(2026, 5, 2, 0, 30).getTime();
    const timestamp = new Date(2026, 5, 1, 23, 30).getTime();

    expect(formatTimestamp(timestamp, now)).toBe("Yesterday");
    expect(getTimeGroup(timestamp, now)).toBe("Yesterday");
  });

  it("uses weekday labels and the last-seven-days group for recent prior calendar days", () => {
    const now = new Date(2026, 5, 8, 12, 0).getTime();
    const timestamp = new Date(2026, 5, 3, 12, 0).getTime();

    expect(formatTimestamp(timestamp, now)).toBe(
      new Date(timestamp).toLocaleDateString([], { weekday: "long" }),
    );
    expect(getTimeGroup(timestamp, now)).toBe("Last 7 Days");
  });

  it("moves seven-day-old timestamps to the last-thirty-days group", () => {
    const now = new Date(2026, 5, 8, 12, 0).getTime();
    const timestamp = new Date(2026, 5, 1, 12, 0).getTime();

    expect(formatTimestamp(timestamp, now)).toBe(
      new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" }),
    );
    expect(getTimeGroup(timestamp, now)).toBe("Last 30 Days");
  });

  it("groups timestamps at least 30 calendar days old as older", () => {
    const now = new Date(2026, 5, 30, 12, 0).getTime();
    const timestamp = new Date(2026, 4, 31, 12, 0).getTime();

    expect(formatTimestamp(timestamp, now)).toBe(
      new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" }),
    );
    expect(getTimeGroup(timestamp, now)).toBe("Older");
  });
});
