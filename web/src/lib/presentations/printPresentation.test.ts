import { describe, expect, it, vi } from "vitest";
import { printPresentation } from "./printPresentation";
import type { PresentationSlideRecord } from "./types";

function slide(position: number, html: string): PresentationSlideRecord {
  return {
    _id: `record_${position}`,
    userId: "user_01",
    projectId: "project_01",
    slideId: `slide_${position}`,
    position,
    title: `Slide ${position + 1}`,
    html,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function printWindowHarness(): {
  close: ReturnType<typeof vi.fn>;
  document: Document;
  focus: ReturnType<typeof vi.fn>;
  openWindow: typeof window.open;
  print: ReturnType<typeof vi.fn>;
} {
  const printDocument = document.implementation.createHTMLDocument("Print");
  const focus = vi.fn();
  const print = vi.fn();
  const close = vi.fn();
  const fakeWindow = {
    clearTimeout: window.clearTimeout.bind(window),
    close,
    closed: false,
    document: printDocument,
    focus,
    opener: {},
    print,
    setTimeout: window.setTimeout.bind(window),
  } as unknown as Window;
  return {
    close,
    document: printDocument,
    focus,
    openWindow: vi.fn().mockReturnValue(fakeWindow) as unknown as typeof window.open,
    print,
  };
}

const SAFE_SLIDE = `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden;background:#fff">
  <h1 data-element-id="headline">A useful deck</h1>
</section>`;

describe("printPresentation", () => {
  it("rejects an empty deck before opening a popup", () => {
    const harness = printWindowHarness();

    expect(() => printPresentation([], "Empty", {}, harness.openWindow)).toThrowError(
      expect.objectContaining({ code: "empty_slide_roots" }),
    );
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  it("prevalidates every slide so invalid markup cannot strand a popup", () => {
    const harness = printWindowHarness();

    expect(() => printPresentation([
      slide(0, SAFE_SLIDE),
      slide(1, "<p>Missing root</p>"),
    ], "Broken", {}, harness.openWindow)).toThrow();
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  it("builds isolated print pages with CSP and starts printing after assets settle", async () => {
    const harness = printWindowHarness();

    printPresentation([
      slide(0, SAFE_SLIDE),
      slide(1, SAFE_SLIDE.replace("A useful deck", "A second slide")),
    ], "Board review", {}, harness.openWindow);

    await vi.waitFor(() => expect(harness.print).toHaveBeenCalledOnce());
    expect(harness.focus).toHaveBeenCalledOnce();
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.document.title).toBe("Board review");
    expect(harness.document.querySelectorAll(".print-slide")).toHaveLength(2);
    expect(harness.document.body.textContent).toContain("A second slide");
    expect(harness.document.querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content"))
      .toBe("default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'");
  });
});
