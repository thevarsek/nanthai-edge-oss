import { describe, expect, it } from "vitest";
import {
  clampPresentationPanelWidth,
  PRESENTATION_PANEL_MAX_WIDTH,
  PRESENTATION_PANEL_MIN_WIDTH,
} from "./useResizablePresentationPanel";

describe("clampPresentationPanelWidth", () => {
  it("honors the panel range while preserving useful chat width", () => {
    expect(clampPresentationPanelWidth(100, 1440)).toBe(PRESENTATION_PANEL_MIN_WIDTH);
    expect(clampPresentationPanelWidth(2_000, 1440)).toBe(PRESENTATION_PANEL_MAX_WIDTH);
    expect(clampPresentationPanelWidth(900, 1100)).toBe(740);
    expect(clampPresentationPanelWidth(623.6, 1440)).toBe(624);
  });
});
