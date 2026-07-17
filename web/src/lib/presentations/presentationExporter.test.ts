import { describe, expect, it, vi } from "vitest";
import { PresentationExportError } from "./presentationExportError";
import { PPTX_MIME_TYPE } from "./presentationExportFile";
import { createDomPresentationExporter } from "./presentationExporter";

function renderedSlide(): HTMLElement {
  const slide = document.createElement("section");
  document.body.appendChild(slide);
  return slide;
}

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("createDomPresentationExporter", () => {
  it("rejects an empty slide list before loading the converter", async () => {
    const moduleLoader = vi.fn();
    const exporter = createDomPresentationExporter({ moduleLoader });

    await expect(exporter.exportPresentation({ slideRoots: [] })).rejects.toMatchObject({
      code: "empty_slide_roots",
    });
    expect(moduleLoader).not.toHaveBeenCalled();
  });

  it("rejects a failed image with structured slide and source details", async () => {
    const slide = renderedSlide();
    const image = document.createElement("img");
    image.src = "https://assets.example.test/missing.png";
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 0 },
    });
    slide.appendChild(image);

    const moduleLoader = vi.fn();
    const exporter = createDomPresentationExporter({ moduleLoader });

    await expect(
      exporter.exportPresentation({ slideRoots: [slide] }),
    ).rejects.toMatchObject({
      code: "image_load_failed",
      details: {
        slideIndex: 0,
        imageSource: "https://assets.example.test/missing.png",
      },
    });
    expect(moduleLoader).not.toHaveBeenCalled();
    slide.remove();
  });

  it("rejects an image that does not finish loading before the deadline", async () => {
    const slide = renderedSlide();
    const image = document.createElement("img");
    image.src = "https://assets.example.test/slow.png";
    Object.defineProperty(image, "complete", { configurable: true, value: false });
    slide.appendChild(image);

    const exporter = createDomPresentationExporter({
      imageLoadTimeoutMs: 1,
      moduleLoader: vi.fn(),
    });

    await expect(exporter.exportPresentation({ slideRoots: [slide] })).rejects.toMatchObject({
      code: "image_load_timed_out",
      details: { slideIndex: 0, timeoutMs: 1 },
    });
    slide.remove();
  });

  it("waits for the owning document's fonts before loading the converter", async () => {
    const slideDocument = document.implementation.createHTMLDocument("slide");
    const slide = slideDocument.createElement("section");
    slideDocument.body.appendChild(slide);
    const fontsReady = deferred();
    Object.defineProperty(slideDocument, "fonts", {
      configurable: true,
      value: { ready: fontsReady.promise },
    });

    const exportToPptx = vi.fn().mockResolvedValue(new Blob(["deck"]));
    const moduleLoader = vi.fn().mockResolvedValue({ exportToPptx });
    const exporter = createDomPresentationExporter({ moduleLoader });
    const exportPromise = exporter.exportPresentation({ slideRoots: [slide] });
    await Promise.resolve();

    expect(moduleLoader).not.toHaveBeenCalled();
    fontsReady.resolve();
    await expect(exportPromise).resolves.toMatchObject({ fileName: "presentation.pptx" });
    expect(moduleLoader).toHaveBeenCalledOnce();
  });

  it("fails with a structured error when an owning document's fonts never settle", async () => {
    const slideDocument = document.implementation.createHTMLDocument("slide");
    const slide = slideDocument.createElement("section");
    slideDocument.body.appendChild(slide);
    Object.defineProperty(slideDocument, "fonts", {
      configurable: true,
      value: { ready: new Promise(() => undefined) },
    });
    const moduleLoader = vi.fn();
    const exporter = createDomPresentationExporter({
      imageLoadTimeoutMs: 1,
      moduleLoader,
    });

    await expect(exporter.exportPresentation({ slideRoots: [slide] })).rejects.toMatchObject({
      code: "font_load_failed",
      details: { timeoutMs: 1 },
    });
    expect(moduleLoader).not.toHaveBeenCalled();
  });

  it("loads the converter on demand with fixed export options and normalizes the Blob", async () => {
    const slide = renderedSlide();
    const rawBlob = new Blob(["pptx payload"], { type: "application/zip" });
    const exportToPptx = vi.fn().mockResolvedValue(rawBlob);
    const moduleLoader = vi.fn().mockResolvedValue({ exportToPptx });
    const exporter = createDomPresentationExporter({ moduleLoader });

    const result = await exporter.exportPresentation({
      slideRoots: [slide],
      suggestedFileName: "Quarterly / Review.pptx",
    });

    expect(moduleLoader).toHaveBeenCalledOnce();
    expect(exportToPptx).toHaveBeenCalledWith([slide], {
      fileName: "Quarterly - Review.pptx",
      skipDownload: true,
      autoEmbedFonts: false,
      svgAsVector: true,
      layout: "LAYOUT_WIDE",
    });
    expect(result.fileName).toBe("Quarterly - Review.pptx");
    expect(result.blob.type).toBe(PPTX_MIME_TYPE);
    expect(await readBlobAsText(result.blob)).toBe("pptx payload");
    slide.remove();
  });

  it("wraps converter failures in a stable structured error", async () => {
    const slide = renderedSlide();
    const failure = new Error("broken package");
    const exporter = createDomPresentationExporter({
      moduleLoader: async () => ({
        exportToPptx: vi.fn().mockRejectedValue(failure),
      }),
    });

    const promise = exporter.exportPresentation({ slideRoots: [slide] });
    await expect(promise).rejects.toBeInstanceOf(PresentationExportError);
    await expect(promise).rejects.toMatchObject({
      code: "conversion_failed",
      cause: failure,
    });
    slide.remove();
  });

  it("rejects an empty converter payload as a conversion failure", async () => {
    const slide = renderedSlide();
    const exporter = createDomPresentationExporter({
      moduleLoader: async () => ({
        exportToPptx: vi.fn().mockResolvedValue(new Blob()),
      }),
    });

    await expect(exporter.exportPresentation({ slideRoots: [slide] })).rejects.toMatchObject({
      code: "conversion_failed",
    });
    slide.remove();
  });
});
