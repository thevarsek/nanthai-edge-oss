import { PresentationExportError } from "./presentationExportError";
import { sanitizeSlideHtml } from "./sanitizeSlideHtml";
import type { PresentationSlideRecord } from "./types";
import type { PresentationAssetUrls } from "./types";

const PRINT_ASSET_TIMEOUT_MS = 10_000;
const PRINT_CSS = `
  @page { size: 13.333333in 7.5in; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #111; }
  .print-slide { width: 1280px; height: 720px; overflow: hidden; break-after: page; page-break-after: always; }
  .print-slide:last-child { break-after: auto; page-break-after: auto; }
  @media screen {
    body { display: grid; gap: 28px; justify-content: center; padding: 28px; }
    .print-slide { box-shadow: 0 18px 60px rgba(0,0,0,.45); }
  }
`;

function settleWithTimeout(
  promise: PromiseLike<unknown>,
  timerWindow: Window,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      timerWindow.clearTimeout(timeout);
      resolve();
    };
    const timeout = timerWindow.setTimeout(finish, PRINT_ASSET_TIMEOUT_MS);
    void Promise.resolve(promise).then(finish, finish);
  });
}

function waitForImage(image: HTMLImageElement, timerWindow: Window): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      timerWindow.clearTimeout(timeout);
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      resolve();
    };
    const timeout = timerWindow.setTimeout(finish, PRINT_ASSET_TIMEOUT_MS);
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
    if (image.complete) finish();
  });
}

async function waitForPrintAssets(document: Document, timerWindow: Window): Promise<void> {
  const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  const images = Array.from(document.images);
  await Promise.all([
    fontSet ? settleWithTimeout(fontSet.ready, timerWindow) : Promise.resolve(),
    ...images.map((image) => waitForImage(image, timerWindow)),
  ]);
}

export function printPresentation(
  slides: readonly PresentationSlideRecord[],
  title: string,
  assetUrls: PresentationAssetUrls = {},
  openWindow: typeof window.open = window.open.bind(window),
): void {
  if (slides.length === 0) {
    throw new PresentationExportError(
      "empty_slide_roots",
      "At least one slide is required to print a presentation.",
    );
  }

  const preparedRoots = slides.map((slide) => {
    const parsed = new DOMParser().parseFromString(
      sanitizeSlideHtml(slide.html, slide.slideId, assetUrls),
      "text/html",
    );
    const root = parsed.querySelector<HTMLElement>(".slide-root");
    if (!root) {
      throw new PresentationExportError(
        "conversion_failed",
        `Slide ${slide.position + 1} has no print root.`,
      );
    }
    return root;
  });

  const printWindow = openWindow("", "_blank");
  if (!printWindow) throw new Error("Allow pop-ups to print this presentation.");
  printWindow.opener = null;

  try {
    const printDocument = printWindow.document;
    printDocument.head.replaceChildren();
    printDocument.body.replaceChildren();
    printDocument.title = title;
    const charset = printDocument.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    const contentSecurityPolicy = printDocument.createElement("meta");
    contentSecurityPolicy.httpEquiv = "Content-Security-Policy";
    contentSecurityPolicy.content = "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'";
    const style = printDocument.createElement("style");
    style.textContent = PRINT_CSS;
    printDocument.head.append(charset, contentSecurityPolicy, style);

    for (const root of preparedRoots) {
      const page = printDocument.createElement("section");
      page.className = "print-slide";
      page.appendChild(printDocument.importNode(root, true));
      printDocument.body.appendChild(page);
    }

    void waitForPrintAssets(printDocument, printWindow).then(() => {
      if (printWindow.closed) return;
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        printWindow.close();
      }
    });
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
