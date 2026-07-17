import { afterEach, describe, expect, it } from "vitest";
import { renderSlidesForExport } from "./renderExportSlides";
import type { PresentationSlideRecord } from "./types";

function slide(position: number, html?: string): PresentationSlideRecord {
  return {
    _id: `record_${position}`,
    userId: "user_01",
    projectId: "project_01",
    slideId: `slide_${position}`,
    position,
    title: `Slide ${position + 1}`,
    html: html ?? `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">
      <h1 data-element-id="headline_${position}">Slide ${position + 1}</h1>
    </section>`,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

let restoreFrameLoader: (() => void) | undefined;

function installSynchronousFrameLoader(): void {
  const prototype = HTMLIFrameElement.prototype;
  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "srcdoc");
  const originalContentDocument = Object.getOwnPropertyDescriptor(prototype, "contentDocument");
  const frameDocuments = new WeakMap<HTMLIFrameElement, Document>();
  const frameSources = new WeakMap<HTMLIFrameElement, string>();

  Object.defineProperty(prototype, "srcdoc", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return frameSources.get(this) ?? "";
    },
    set(this: HTMLIFrameElement, value: string) {
      frameSources.set(this, value);
      frameDocuments.set(this, new DOMParser().parseFromString(value, "text/html"));
      this.dispatchEvent(new Event("load"));
    },
  });
  Object.defineProperty(prototype, "contentDocument", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return frameDocuments.get(this) ?? null;
    },
  });

  restoreFrameLoader = () => {
    if (originalDescriptor) Object.defineProperty(prototype, "srcdoc", originalDescriptor);
    else Reflect.deleteProperty(prototype, "srcdoc");
    if (originalContentDocument) {
      Object.defineProperty(prototype, "contentDocument", originalContentDocument);
    } else {
      Reflect.deleteProperty(prototype, "contentDocument");
    }
  };
}

afterEach(() => {
  restoreFrameLoader?.();
  restoreFrameLoader = undefined;
  document.querySelectorAll("[data-presentation-export-host]").forEach((host) => host.remove());
});

describe("renderSlidesForExport", () => {
  it("listens before assigning srcdoc and returns roots in slide order", async () => {
    installSynchronousFrameLoader();

    const rendered = await renderSlidesForExport([slide(0), slide(1)]);

    expect(rendered.roots.map((root) => root.textContent?.trim()))
      .toEqual(["Slide 1", "Slide 2"]);
    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>(
      "[data-presentation-export-host] iframe",
    ));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveAttribute("sandbox", "allow-same-origin");
    expect(frames[0]).toHaveAttribute("referrerpolicy", "no-referrer");

    rendered.cleanup();
    expect(document.querySelector("[data-presentation-export-host]")).toBeNull();
  });

  it("does not leak its off-screen host when a slide cannot be sanitized", async () => {
    await expect(renderSlidesForExport([
      slide(0),
      slide(1, "<p>Missing root</p>"),
    ])).rejects.toMatchObject({ code: "conversion_failed" });

    expect(document.querySelector("[data-presentation-export-host]")).toBeNull();
  });
});
