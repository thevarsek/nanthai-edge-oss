import { sanitizeSlideHtml } from "./sanitizeSlideHtml";
import type { PresentationAssetUrls } from "./types";

const FRAME_BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body { background: transparent; }
  .slide-root {
    position: relative;
    width: 1280px;
    height: 720px;
    overflow: hidden;
    transform-origin: top left;
  }
  .nanth-selected {
    outline: 3px solid #ff5f3d !important;
    outline-offset: 2px;
    cursor: move;
  }
  .nanth-selection-only { cursor: default; }
  [data-nanth-resize-handle] {
    position: fixed;
    z-index: 2147483647;
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff;
    border-radius: 50%;
    background: #ff5f3d;
    box-shadow: 0 0 0 1px rgba(0,0,0,.55);
    cursor: nwse-resize;
  }
  [contenteditable="true"] { cursor: text; }
`;

const FRAME_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self' https:",
  "style-src 'unsafe-inline'",
].join("; ");

export function buildSlideFrameDocument(
  html: string,
  slideId: string,
  assetUrls: PresentationAssetUrls = {},
): string {
  const sanitized = sanitizeSlideHtml(html, slideId, assetUrls);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CONTENT_SECURITY_POLICY}"><style data-nanth-frame-style>${FRAME_BASE_CSS}</style></head><body>${sanitized}</body></html>`;
}

function removeInlineStyleProperty(element: HTMLElement, property: string): void {
  const declarations = (element.getAttribute("style") ?? "")
    .split(";")
    .filter((declaration) => declaration.slice(0, declaration.indexOf(":"))
      .trim()
      .toLowerCase() !== property);
  const style = declarations.join(";").trim();
  if (style) element.setAttribute("style", style);
  else element.removeAttribute("style");
}

export function serializeSlideFrame(document: Document): string {
  const root = document.querySelector<HTMLElement>(".slide-root");
  if (!root) return "";

  const serializedRoot = root.cloneNode(true) as HTMLElement;
  serializedRoot.querySelectorAll(".nanth-selected, .nanth-selection-only").forEach((element) => {
    element.classList.remove("nanth-selected");
    element.classList.remove("nanth-selection-only");
    if (!element.getAttribute("class")?.trim()) element.removeAttribute("class");
  });
  serializedRoot.querySelectorAll("[class]").forEach((element) => {
    if (!element.getAttribute("class")?.trim()) element.removeAttribute("class");
  });
  serializedRoot.querySelectorAll("[contenteditable]").forEach((element) => {
    element.removeAttribute("contenteditable");
  });
  serializedRoot.querySelectorAll("[data-nanth-resize-handle]")
    .forEach((element) => element.remove());
  serializedRoot.querySelectorAll<HTMLElement>("[data-nanth-asset-id]").forEach((element) => {
    const assetId = element.getAttribute("data-nanth-asset-id");
    if (assetId) element.setAttribute("src", `asset:${assetId}`);
    element.removeAttribute("data-nanth-asset-id");
  });
  removeInlineStyleProperty(serializedRoot, "transform");
  return serializedRoot.outerHTML;
}

export function scaleSlideFrame(document: Document, viewportWidth: number): number {
  const root = document.querySelector<HTMLElement>(".slide-root");
  if (!root) return 1;
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : 1280;
  const scale = Math.max(0.05, safeViewportWidth / 1280);
  root.style.transform = `scale(${scale})`;
  return scale;
}
