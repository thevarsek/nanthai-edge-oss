import { describe, expect, test } from "vitest";
import {
  statusBadgeClass,
  statusDotClass,
  statusTextClass,
  toneForStatus,
  workspaceIconBlockClass,
  workspaceSurfaceClass,
} from "./uiTokens";

describe("ui semantic tokens", () => {
  test("maps product statuses to canonical tones", () => {
    expect(toneForStatus("pending")).toBe("pending");
    expect(toneForStatus("streaming")).toBe("running");
    expect(toneForStatus("polling")).toBe("running");
    expect(toneForStatus("completed")).toBe("success");
    expect(toneForStatus("failed")).toBe("danger");
    expect(toneForStatus("cancelled")).toBe("warning");
    expect(toneForStatus("pro")).toBe("locked");
  });

  test("returns canonical text, fill, and dot classes", () => {
    expect(statusTextClass("running")).toBe("text-primary");
    expect(statusDotClass("success")).toBe("bg-success");
    expect(statusBadgeClass("error")).toContain("bg-destructive/15");
    expect(statusBadgeClass("paused")).toContain("text-warning");
  });

  test("returns compact workspace card and icon classes", () => {
    expect(workspaceSurfaceClass("min-h-[64px]")).toContain("rounded-xl");
    expect(workspaceSurfaceClass("min-h-[64px]")).toContain("min-h-[64px]");
    expect(workspaceIconBlockClass()).toContain("h-10");
    expect(workspaceIconBlockClass("text-info")).toContain("text-info");
  });
});
