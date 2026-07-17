import { PresentationExportError } from "./presentationExportError";
import { buildSlideFrameDocument } from "./slideFrameDocument";
import type { PresentationSlideRecord } from "./types";
import type { PresentationAssetUrls } from "./types";

const FRAME_LOAD_TIMEOUT_MS = 10_000;

export interface RenderedExportSlides {
  roots: HTMLElement[];
  cleanup(): void;
}

function waitForFrame(
  frame: HTMLIFrameElement,
  slide: PresentationSlideRecord,
  signal: AbortSignal,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const timerWindow = frame.ownerDocument.defaultView ?? window;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const timeout = timerWindow.setTimeout(() => {
      finish(() => reject(new PresentationExportError(
        "conversion_failed",
        `Slide ${slide.position + 1} did not render in time.`,
      )));
    }, FRAME_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      timerWindow.clearTimeout(timeout);
      frame.removeEventListener("load", handleLoad);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleLoad = () => {
      finish(() => {
        const root = frame.contentDocument?.querySelector<HTMLElement>(".slide-root");
        if (!root) {
          reject(new PresentationExportError(
            "conversion_failed",
            `Slide ${slide.position + 1} has no export root.`,
          ));
          return;
        }
        resolve(root);
      });
    };
    const handleAbort = () => {
      finish(() => reject(new PresentationExportError(
        "conversion_failed",
        `Slide ${slide.position + 1} rendering was cancelled.`,
      )));
    };

    frame.addEventListener("load", handleLoad, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

export async function renderSlidesForExport(
  slides: readonly PresentationSlideRecord[],
  ownerDocument: Document = document,
  assetUrls: PresentationAssetUrls = {},
): Promise<RenderedExportSlides> {
  if (slides.length === 0) {
    throw new PresentationExportError(
      "empty_slide_roots",
      "At least one slide is required for export.",
    );
  }

  const host = ownerDocument.createElement("div");
  host.setAttribute("data-presentation-export-host", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "1280px",
    pointerEvents: "none",
    opacity: "0.01",
    zIndex: "-1",
  });

  const abortController = new AbortController();
  try {
    const frames = slides.map((slide) => {
      const frame = ownerDocument.createElement("iframe");
      frame.title = `Export slide ${slide.position + 1}`;
      frame.width = "1280";
      frame.height = "720";
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.style.display = "block";
      frame.style.width = "1280px";
      frame.style.height = "720px";
      frame.style.border = "0";
      return {
        documentHtml: buildSlideFrameDocument(slide.html, slide.slideId, assetUrls),
        frame,
        slide,
      };
    });

    ownerDocument.body.appendChild(host);
    const rootPromises = frames.map(({ documentHtml, frame, slide }) => {
      const rootPromise = waitForFrame(frame, slide, abortController.signal);
      frame.srcdoc = documentHtml;
      host.appendChild(frame);
      return rootPromise;
    });
    const roots = await Promise.all(rootPromises);
    return { roots, cleanup: () => host.remove() };
  } catch (error) {
    abortController.abort();
    host.remove();
    if (error instanceof PresentationExportError) throw error;
    throw new PresentationExportError(
      "conversion_failed",
      "The slides could not be prepared for export.",
      {},
      error,
    );
  }
}
