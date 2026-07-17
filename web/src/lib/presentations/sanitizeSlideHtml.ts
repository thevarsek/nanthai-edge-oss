import type { PresentationAssetUrls } from "./types";

const ALLOWED_TAGS = new Set([
  "div",
  "section",
  "p",
  "h1",
  "h2",
  "h3",
  "span",
  "img",
  "svg",
  "path",
  "line",
  "rect",
  "circle",
  "br",
]);

const GLOBAL_ATTRIBUTES = new Set([
  "class",
  "style",
  "data-element-id",
  "data-element-role",
  "aria-label",
  "role",
]);

const SVG_ATTRIBUTES = new Set([
  "viewbox",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "transform",
  "preserveaspectratio",
  "xmlns",
  "fill-opacity",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
]);

const UNSAFE_CSS = /@import|url\s*\(|(?:image|image-set|cross-fade)\s*\(|expression\s*\(|javascript:|https?:|data:|\/\/|\/\*|\\|behavior\s*:|-moz-binding/i;
const MAX_SLIDE_HTML_BYTES = 100_000;

export class SlideHtmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlideHtmlError";
  }
}

function safeElementId(raw: string): string {
  const normalized = raw
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const withLetterPrefix = /^[a-zA-Z]/.test(normalized) ? normalized : `element-${normalized}`;
  return withLetterPrefix.slice(0, 64).replace(/-$/g, "") || "element";
}

function uniqueElementId(raw: string, usedElementIds: Set<string>): string {
  const base = safeElementId(raw);
  let candidate = base;
  let suffix = 2;
  while (usedElementIds.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedElementIds.add(candidate);
  return candidate;
}

function sanitizeStyle(value: string): string {
  if (UNSAFE_CSS.test(value)) return "";
  return value.replace(/[<>]/g, "").trim();
}

function presentationAssetId(source: string): string | undefined {
  return source.startsWith("asset:") && source.length > "asset:".length
    ? source.slice("asset:".length)
    : undefined;
}

function safeResolvedAssetUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.origin === window.location.origin
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function removeReservedClasses(element: Element): void {
  const safeClasses = Array.from(element.classList)
    .filter((className) => !className.startsWith("nanth-"));
  if (safeClasses.length > 0) element.setAttribute("class", safeClasses.join(" "));
  else element.removeAttribute("class");
}

function sanitizeElement(
  element: Element,
  slideId: string,
  index: number,
  usedElementIds: Set<string>,
  assetUrls: PresentationAssetUrls,
): void {
  const tag = element.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    element.remove();
    return;
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const isAllowed = tag !== "br" && (
      GLOBAL_ATTRIBUTES.has(name) || SVG_ATTRIBUTES.has(name) ||
      (tag === "img" && (name === "src" || name === "alt"))
    );
    if (!isAllowed || name.startsWith("on")) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === "style") {
      const sanitized = sanitizeStyle(attribute.value);
      if (sanitized) element.setAttribute("style", sanitized);
      else element.removeAttribute("style");
    }
  }

  removeReservedClasses(element);

  if (tag === "img") {
    const src = element.getAttribute("src") ?? "";
    const assetId = presentationAssetId(src);
    const resolved = assetId ? safeResolvedAssetUrl(assetUrls[assetId]) : undefined;
    if (assetId && resolved) {
      element.setAttribute("src", resolved);
      element.setAttribute("data-nanth-asset-id", assetId);
    } else {
      element.removeAttribute("src");
    }
    element.setAttribute("alt", element.getAttribute("alt") ?? "");
  }

  if (tag !== "br" && !element.classList.contains("slide-root")) {
    const existing = element.getAttribute("data-element-id");
    element.setAttribute(
      "data-element-id",
      uniqueElementId(existing ?? `${slideId}-element-${index}`, usedElementIds),
    );
  }
}

export function sanitizeSlideHtml(
  html: string,
  slideId: string,
  assetUrls: PresentationAssetUrls = {},
): string {
  if (!html.trim()) throw new SlideHtmlError("Slide HTML is empty.");
  if (new TextEncoder().encode(html).byteLength > MAX_SLIDE_HTML_BYTES) {
    throw new SlideHtmlError("Slide HTML is too large.");
  }
  if (typeof DOMParser === "undefined") {
    throw new SlideHtmlError("Slide HTML requires a browser DOM parser.");
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script,iframe,object,embed,form,link,meta,base").forEach((node) => node.remove());
  const usedElementIds = new Set<string>();

  Array.from(document.body.querySelectorAll("*")).forEach((element, index) => {
    sanitizeElement(element, slideId, index, usedElementIds, assetUrls);
  });
  Array.from(document.head.querySelectorAll("*")).forEach((element, index) => {
    sanitizeElement(element, slideId, index + 10_000, usedElementIds, assetUrls);
  });

  const roots = Array.from(document.body.querySelectorAll<HTMLElement>(".slide-root"));
  if (roots.length !== 1) {
    throw new SlideHtmlError("Slide HTML must include exactly one .slide-root element.");
  }
  const root = roots[0];
  if (!root) throw new SlideHtmlError("Slide HTML must include exactly one .slide-root element.");
  root.removeAttribute("data-element-id");
  root.style.position = "relative";
  root.style.width = "1280px";
  root.style.height = "720px";
  root.style.overflow = "hidden";
  root.style.removeProperty("transform");

  return root.outerHTML;
}

export function slideRootFromHtml(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html").querySelector<HTMLElement>(".slide-root");
}
