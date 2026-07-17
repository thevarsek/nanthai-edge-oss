import type { exportToPptx } from "dom-to-pptx";
import { PresentationExportError } from "./presentationExportError";
import {
  normalizePptxBlob,
  safePresentationFileName,
} from "./presentationExportFile";

const DEFAULT_IMAGE_LOAD_TIMEOUT_MS = 15_000;

export interface PresentationExportRequest {
  readonly slideRoots: readonly HTMLElement[];
  readonly suggestedFileName?: string;
}

export interface PresentationExportResult {
  readonly blob: Blob;
  readonly fileName: string;
}

export interface PresentationExporter {
  exportPresentation(request: PresentationExportRequest): Promise<PresentationExportResult>;
}

type DomToPptxModule = {
  exportToPptx: typeof exportToPptx;
};

export type DomToPptxModuleLoader = () => Promise<DomToPptxModule>;

export interface DomPresentationExporterOptions {
  readonly moduleLoader?: DomToPptxModuleLoader;
  readonly imageLoadTimeoutMs?: number;
}

interface SlideImage {
  readonly image: HTMLImageElement;
  readonly slideIndex: number;
}

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.getAttribute("src") || "unknown image";
}

function imageError(
  code: "image_load_failed" | "image_load_timed_out",
  slideImage: SlideImage,
  timeoutMs?: number,
): PresentationExportError {
  const source = imageSource(slideImage.image);
  const message =
    code === "image_load_timed_out"
      ? `An image did not load within ${timeoutMs}ms: ${source}`
      : `An image could not be loaded: ${source}`;

  return new PresentationExportError(code, message, {
    slideIndex: slideImage.slideIndex,
    imageSource: source,
    timeoutMs,
  });
}

function waitForImage(slideImage: SlideImage, timeoutMs: number): Promise<void> {
  const { image } = slideImage;
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(imageError("image_load_failed", slideImage));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(imageError("image_load_timed_out", slideImage, timeoutMs));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      if (image.naturalWidth > 0) {
        resolve();
      } else {
        reject(imageError("image_load_failed", slideImage));
      }
    };
    const handleError = () => {
      cleanup();
      reject(imageError("image_load_failed", slideImage));
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });

    if (image.complete) {
      handleLoad();
    }
  });
}

function waitForFontSet(fontSet: FontFaceSet, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Fonts did not load within ${timeoutMs}ms.`)));
    }, timeoutMs);
    void fontSet.ready.then(
      () => finish(resolve),
      (error) => finish(() => reject(error)),
    );
  });
}

async function waitForFonts(
  slideRoots: readonly HTMLElement[],
  timeoutMs: number,
): Promise<void> {
  const documents = new Set(slideRoots.map((root) => root.ownerDocument));
  try {
    await Promise.all(
      Array.from(documents, async (slideDocument) => {
        const fontSet = (slideDocument as Document & { fonts?: FontFaceSet }).fonts;
        if (fontSet) {
          await waitForFontSet(fontSet, timeoutMs);
        }
      }),
    );
  } catch (error) {
    throw new PresentationExportError(
      "font_load_failed",
      "The presentation fonts could not be prepared for export.",
      { timeoutMs },
      error,
    );
  }
}

export async function waitForPresentationAssets(
  slideRoots: readonly HTMLElement[],
  imageLoadTimeoutMs = DEFAULT_IMAGE_LOAD_TIMEOUT_MS,
): Promise<void> {
  const images = slideRoots.flatMap((root, slideIndex) =>
    Array.from(root.querySelectorAll("img"), (image) => ({ image, slideIndex })),
  );

  await Promise.all([
    waitForFonts(slideRoots, imageLoadTimeoutMs),
    ...images.map((slideImage) => waitForImage(slideImage, imageLoadTimeoutMs)),
  ]);
}

const loadDomToPptx: DomToPptxModuleLoader = () => import("dom-to-pptx");

export function createDomPresentationExporter(
  options: DomPresentationExporterOptions = {},
): PresentationExporter {
  const moduleLoader = options.moduleLoader ?? loadDomToPptx;
  const configuredTimeout = options.imageLoadTimeoutMs ?? DEFAULT_IMAGE_LOAD_TIMEOUT_MS;
  const imageLoadTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_IMAGE_LOAD_TIMEOUT_MS;

  return {
    async exportPresentation(request) {
      if (request.slideRoots.length === 0) {
        throw new PresentationExportError(
          "empty_slide_roots",
          "At least one rendered slide is required for export.",
        );
      }

      await waitForPresentationAssets(request.slideRoots, imageLoadTimeoutMs);

      let converter: DomToPptxModule;
      try {
        converter = await moduleLoader();
      } catch (error) {
        throw new PresentationExportError(
          "converter_unavailable",
          "The PowerPoint exporter could not be loaded.",
          {},
          error,
        );
      }

      const fileName = safePresentationFileName(request.suggestedFileName);
      try {
        const blob = await converter.exportToPptx([...request.slideRoots], {
          fileName,
          skipDownload: true,
          autoEmbedFonts: false,
          svgAsVector: true,
          layout: "LAYOUT_WIDE",
        });
        if (blob.size === 0) {
          throw new Error("The PowerPoint converter returned an empty file.");
        }
        return { blob: normalizePptxBlob(blob), fileName };
      } catch (error) {
        throw new PresentationExportError(
          "conversion_failed",
          "The slides could not be converted to PowerPoint.",
          {},
          error,
        );
      }
    },
  };
}

export const presentationExporter = createDomPresentationExporter();
