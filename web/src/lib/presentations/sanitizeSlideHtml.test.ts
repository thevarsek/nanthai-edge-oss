import { describe, expect, it } from "vitest";
import { sanitizeSlideHtml, SlideHtmlError } from "./sanitizeSlideHtml";

describe("sanitizeSlideHtml", () => {
  it("keeps a safe editable slide without adding backend-incompatible attributes", () => {
    const result = sanitizeSlideHtml(
      `<div class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">
        <h1 data-element-id="headline" style="position:absolute;left:80px;top:70px">A clear idea</h1>
      </div>`,
      "slide_01",
    );

    expect(result).toContain("data-element-id=\"headline\"");
    expect(result).not.toContain("data-slide-id");
    expect(result).not.toContain("contenteditable");
  });

  it("preserves typography role metadata across direct web edits", () => {
    const result = sanitizeSlideHtml(
      `<div class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">
        <h1 data-element-id="headline" data-element-role="slide-title">A clear idea</h1>
      </div>`,
      "slide_role",
    );

    expect(result).toContain("data-element-role=\"slide-title\"");
  });

  it("preserves inert line breaks without manufacturing editable IDs", () => {
    const result = sanitizeSlideHtml(
      `<div class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">
        <h1 data-element-id="headline">First line<br class="ignored" data-element-id="ignored">Second line</h1>
      </div>`,
      "slide_break",
    );

    const parsed = new DOMParser().parseFromString(result, "text/html");
    const lineBreak = parsed.querySelector("br");
    expect(lineBreak).not.toBeNull();
    expect(lineBreak?.attributes).toHaveLength(0);
    expect(parsed.querySelector('[data-element-id="headline"]')?.textContent)
      .toBe("First lineSecond line");
  });

  it("removes active content, handlers, unsafe CSS, and external images", () => {
    const result = sanitizeSlideHtml(
      `<script>alert(1)</script><div class="slide-root" onclick="alert(2)" style="position:relative;width:1280px;height:720px;background:url(https://bad.test/a)">
        <img data-element-id="photo" src="https://bad.test/photo.jpg" onerror="alert(3)" alt="Photo">
      </div>`,
      "slide_02",
    );

    expect(result).not.toContain("script");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("https://bad.test");
    expect(result).not.toContain("background:");
  });

  it("rejects CSS escape and comment bypasses and strips style elements", () => {
    const result = sanitizeSlideHtml(
      `<style>.slide-root { color: red; }</style>
      <div class="slide-root" style="position:relative;width:1280px;height:720px">
        <div data-element-id="escaped" style="background:u\\72l(https://bad.test/a)">A</div>
        <div data-element-id="commented" style="background:u/**/rl(https://bad.test/b)">B</div>
      </div>`,
      "slide_css",
    );

    expect(result).not.toContain("<style");
    expect(result).not.toContain("https://bad.test");
    expect(result).not.toContain("background:");
  });

  it("resolves an owned asset placeholder and preserves safe SVG geometry", () => {
    const result = sanitizeSlideHtml(
      `<section class="slide-root" style="position:relative;width:1280px;height:720px">
        <img data-element-id="photo" src="asset:storage_image_1" alt="Workplace">
        <svg data-element-id="mark" viewBox="0 0 20 20" opacity="0.8"><circle data-element-id="dot" cx="10" cy="10" r="5" /></svg>
      </section>`,
      "slide_03",
      { storage_image_1: "https://files.example/workplace.jpg" },
    );

    expect(result).toContain("https://files.example/workplace.jpg");
    expect(result).toContain("data-nanth-asset-id=\"storage_image_1\"");
    expect(result).toMatch(/viewBox|viewbox/);
    expect(result).toContain("opacity=\"0.8\"");
  });

  it("keeps the backend SVG contract and assigns unique stable IDs to every child", () => {
    const result = sanitizeSlideHtml(
      `<section class="slide-root" style="position:relative;width:1280px;height:720px">
        <span data-element-id="123 duplicate">Label</span>
        <svg data-element-id="123 duplicate" viewBox="0 0 20 20">
          <path d="M0 0L10 10" stroke-dasharray="2 3" fill-opacity="0.5" />
        </svg>
      </section>`,
      "slide_ids",
    );

    const root = new DOMParser().parseFromString(result, "text/html");
    const ids = Array.from(root.querySelectorAll<HTMLElement>("[data-element-id]"))
      .map((element) => element.dataset.elementId);
    expect(ids).toEqual([
      "element-123-duplicate",
      "element-123-duplicate-2",
      "slide_ids-element-3",
    ]);
    expect(result).toContain("stroke-dasharray=\"2 3\"");
    expect(result).toContain("fill-opacity=\"0.5\"");
  });

  it("normalizes the fixed canvas and removes reserved editor classes", () => {
    const result = sanitizeSlideHtml(
      `<div class="slide-root nanth-selected" style="position:fixed;width:20px;height:10px;overflow:visible;transform:scale(2);background:#fff">
        <p class="copy nanth-selected" data-element-id="copy">Text</p>
      </div>`,
      "slide_canvas",
    );

    const root = new DOMParser().parseFromString(result, "text/html")
      .querySelector<HTMLElement>(".slide-root");
    expect(root?.style.position).toBe("relative");
    expect(root?.style.width).toBe("1280px");
    expect(root?.style.height).toBe("720px");
    expect(root?.style.overflow).toBe("hidden");
    expect(root?.style.transform).toBe("");
    expect(result).not.toContain("nanth-selected");
    expect(root?.style.background).toBe("rgb(255, 255, 255)");
  });

  it("rejects every image source except an owned asset placeholder", () => {
    const result = sanitizeSlideHtml(
      `<div class="slide-root" style="position:relative;width:1280px;height:720px">
        <img data-element-id="plain" src="/api/private" alt="">
        <img data-element-id="encoded" src="asset:unknown" alt="">
        <img data-element-id="remote" src="//bad.test/photo.jpg" alt="">
        <img data-element-id="unapproved" src="https://files.example/photo.jpg" alt="">
      </div>`,
      "slide_paths",
    );

    expect(result).not.toContain(" src=");
  });

  it("rejects markup without a slide root", () => {
    expect(() => sanitizeSlideHtml("<p>Not a slide</p>", "missing"))
      .toThrow(SlideHtmlError);
  });

  it("rejects markup with more than one slide root", () => {
    expect(() => sanitizeSlideHtml(
      `<div class="slide-root"></div><section class="slide-root"></section>`,
      "duplicate",
    )).toThrow(SlideHtmlError);
  });
});
