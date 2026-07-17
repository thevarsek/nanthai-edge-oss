import { describe, expect, it } from "vitest";
import {
  buildSlideFrameDocument,
  scaleSlideFrame,
  serializeSlideFrame,
} from "./slideFrameDocument";

const SLIDE_HTML = `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden;background:#fff">
  <h1 data-element-id="headline" style="position:absolute;left:80px;top:60px">Title</h1>
</section>`;

describe("slide frame document", () => {
  it("builds a sandbox-friendly document with an explicit content security policy", () => {
    const frameHtml = buildSlideFrameDocument(SLIDE_HTML, "slide_01");
    const frameDocument = new DOMParser().parseFromString(frameHtml, "text/html");

    expect(frameDocument.querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content"))
      .toBe("default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'");
    expect(frameDocument.querySelector("style[data-nanth-frame-style]")).not.toBeNull();
    expect(frameDocument.querySelector(".slide-root")).not.toBeNull();
  });

  it("resolves owned assets for rendering and restores canonical placeholders on save", () => {
    const assetSlide = SLIDE_HTML.replace(
      "</section>",
      '<img data-element-id="hero" src="asset:storage_image_1" alt="Reference"></section>',
    );
    const frameDocument = new DOMParser().parseFromString(
      buildSlideFrameDocument(assetSlide, "slide_01", {
        storage_image_1: "https://files.example/reference.png",
      }),
      "text/html",
    );

    expect(frameDocument.querySelector("img")?.getAttribute("src"))
      .toBe("https://files.example/reference.png");
    const serialized = serializeSlideFrame(frameDocument);
    expect(serialized).toContain('src="asset:storage_image_1"');
    expect(serialized).not.toContain("data-nanth-asset-id");
  });

  it("serializes a clean clone without mutating live editor state", () => {
    const frameDocument = new DOMParser().parseFromString(
      buildSlideFrameDocument(SLIDE_HTML, "slide_01"),
      "text/html",
    );
    const root = frameDocument.querySelector<HTMLElement>(".slide-root");
    const headline = frameDocument.querySelector<HTMLElement>("[data-element-id='headline']");
    expect(root).not.toBeNull();
    expect(headline).not.toBeNull();
    if (!root || !headline) return;

    root.style.transform = "scale(0.5)";
    headline.classList.add("nanth-selected");
    headline.setAttribute("contenteditable", "true");
    const emptyClass = frameDocument.createElement("span");
    emptyClass.setAttribute("class", "");
    root.appendChild(emptyClass);
    const handle = frameDocument.createElement("div");
    handle.setAttribute("data-nanth-resize-handle", "true");
    frameDocument.body.appendChild(handle);

    const serialized = serializeSlideFrame(frameDocument);

    expect(serialized).not.toContain("scale(0.5)");
    expect(serialized).not.toContain("nanth-selected");
    expect(serialized).not.toContain("class=\"\"");
    expect(serialized).not.toContain("contenteditable");
    expect(serialized).not.toContain("data-nanth-resize-handle");
    expect(serialized).not.toContain("data-nanth-frame-style");
    expect(root.style.transform).toBe("scale(0.5)");
    expect(headline.classList.contains("nanth-selected")).toBe(true);
    expect(headline.getAttribute("contenteditable")).toBe("true");
    expect(handle.isConnected).toBe(true);
  });

  it("uses a safe full-size scale when the measured viewport is invalid", () => {
    const frameDocument = new DOMParser().parseFromString(
      buildSlideFrameDocument(SLIDE_HTML, "slide_01"),
      "text/html",
    );

    expect(scaleSlideFrame(frameDocument, Number.NaN)).toBe(1);
    expect(frameDocument.querySelector<HTMLElement>(".slide-root")?.style.transform)
      .toBe("scale(1)");
  });
});
