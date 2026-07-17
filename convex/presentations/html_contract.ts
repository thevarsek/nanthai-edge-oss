import { MAX_HTML_BYTES, presentationError } from "./limits";
import { normalizeSvgPrimitiveElementIds } from "./html_element_id_normalization";

export const PRESENTATION_ALLOWED_HTML_TAGS = [
  "div", "section", "p", "h1", "h2", "h3", "span", "img", "svg",
  "path", "line", "rect", "circle", "br",
] as const;
const ALLOWED_TAGS = new Set<string>(PRESENTATION_ALLOWED_HTML_TAGS);
const VOID_TAGS = new Set(["img", "br"]);
const ALLOWED_ATTRIBUTES = new Set([
  "class", "style", "data-element-id", "data-element-role", "src", "alt", "role", "aria-label",
  "viewbox", "xmlns", "d", "x", "y", "x1", "y1", "x2", "y2", "cx",
  "cy", "r", "rx", "ry", "width", "height", "fill", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform",
  "preserveaspectratio", "fill-opacity", "stroke-opacity", "stroke-dasharray",
  "stroke-dashoffset",
]);
const ALLOWED_CSS_PROPERTIES = new Set([
  "position", "top", "right", "bottom", "left", "width", "height",
  "min-width", "min-height", "max-width", "max-height", "display",
  "flex-direction", "flex-wrap", "justify-content", "align-items",
  "align-content", "align-self", "justify-self", "place-items", "flex",
  "flex-grow", "flex-shrink", "flex-basis", "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-template-areas",
  "grid-column", "grid-row", "grid-area", "grid-auto-flow", "padding", "padding-top",
  "padding-right", "padding-bottom", "padding-left", "margin", "margin-top",
  "margin-right", "margin-bottom", "margin-left", "box-sizing", "overflow",
  "background", "background-color", "background-image", "background-position",
  "background-size", "background-repeat", "color", "border", "border-top",
  "border-right", "border-bottom", "border-left", "border-width",
  "border-style", "border-color", "border-radius", "outline", "outline-offset",
  "box-shadow", "text-shadow", "opacity", "aspect-ratio", "overflow-x", "overflow-y",
  "font-family", "font-size", "font-weight", "font-style", "line-height",
  "letter-spacing", "text-align", "text-transform", "text-decoration",
  "white-space", "word-break", "overflow-wrap", "text-overflow", "vertical-align",
  "object-fit", "object-position", "z-index", "transform", "transform-origin",
  "clip-path", "mix-blend-mode",
]);
const HTML_ENTITY = /&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+)/i;
const UNSAFE_ATTRIBUTE_VALUE = /url\s*\(|javascript:|https?:|data:|\/\*|\\/i;

interface HtmlInspection {
  html: string;
  elementIds: Set<string>;
  usedAssetStorageIds: Set<string>;
}

interface ElementIdIssue {
  kind: "missing" | "duplicate";
  tag: string;
  elementIndex: number;
  elementId?: string;
}

function describeElementIdIssues(issues: readonly ElementIdIssue[]): string {
  const details = issues.map((issue) => issue.kind === "missing"
    ? `missing data-element-id on <${issue.tag}> at element ${issue.elementIndex}`
    : `duplicate data-element-id '${issue.elementId}' on <${issue.tag}> at element ${issue.elementIndex}`);
  return `Slide element ID validation failed: ${details.join("; ")}.`;
}

function invalidHtml(message: string): never {
  throw presentationError("MODEL_RESPONSE_INVALID", message);
}

function parseAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /\s+([A-Za-z_:][A-Za-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let cursor = 0;
  for (const match of raw.matchAll(pattern)) {
    const gap = raw.slice(cursor, match.index);
    if (gap.trim() && gap.trim() !== "/") {
      invalidHtml("Slide HTML contains a malformed or unquoted attribute.");
    }
    const name = match[1]?.toLowerCase();
    if (!name || attributes.has(name)) {
      invalidHtml("Slide HTML contains a duplicate or invalid attribute.");
    }
    attributes.set(name, match[2] ?? match[3] ?? "");
    cursor = (match.index ?? 0) + match[0].length;
  }
  const tail = raw.slice(cursor).trim();
  if (tail && tail !== "/") {
    invalidHtml("Slide HTML contains a malformed or unquoted attribute.");
  }
  return attributes;
}

function validateStyle(style: string): Map<string, string> {
  if (
    style.length > 4_000 ||
    /@import|url\s*\(|(?:image|image-set|cross-fade)\s*\(|expression\s*\(|javascript:|https?:|data:|\/\/|\/\*|\\/i.test(style)
  ) {
    invalidHtml("Slide CSS contains an unsafe construct.");
  }
  const declarations = new Map<string, string>();
  for (const rawDeclaration of style.split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const separator = declaration.indexOf(":");
    if (separator <= 0) invalidHtml("Slide CSS contains a malformed declaration.");
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!ALLOWED_CSS_PROPERTIES.has(property) || !value || /[{}@]/.test(value)) {
      invalidHtml(`Slide CSS property '${property}' is not allowed.`);
    }
    declarations.set(property, value);
  }
  return declarations;
}

function validateAttributes(
  tag: string,
  attributes: Map<string, string>,
  allowedAssetStorageIds: ReadonlySet<string>,
): { elementId?: string; usedAssetStorageId?: string } {
  let usedAssetStorageId: string | undefined;
  for (const [name, value] of attributes) {
    if (!ALLOWED_ATTRIBUTES.has(name) || name.startsWith("on")) {
      invalidHtml(`Slide HTML attribute '${name}' is not allowed.`);
    }
    if (HTML_ENTITY.test(value) || (name !== "xmlns" && UNSAFE_ATTRIBUTE_VALUE.test(value))) {
      invalidHtml(`Slide HTML attribute '${name}' contains an unsafe value.`);
    }
    if (name === "style") validateStyle(value);
    if (name === "class" && !/^[A-Za-z0-9 _-]{1,200}$/.test(value)) {
      invalidHtml("Slide HTML contains an invalid class name.");
    }
    if (name === "data-element-id" && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
      invalidHtml("Every editable element needs a stable data-element-id.");
    }
    if (name === "data-element-role" && !/^[a-z][a-z-]{0,31}$/.test(value)) {
      invalidHtml("Slide typography roles must use a short lowercase token.");
    }
    if (name === "src") {
      const storageId = value.startsWith("asset:") ? value.slice("asset:".length) : "";
      if (tag !== "img" || !storageId || !allowedAssetStorageIds.has(storageId)) {
        invalidHtml("Slide images must use a user-owned presentation asset.");
      }
      usedAssetStorageId = storageId;
    }
    if (tag === "img" && name === "alt" && value.length > 500) {
      invalidHtml("Slide image alt text is too long.");
    }
    if (name === "xmlns" && (tag !== "svg" || value !== "http://www.w3.org/2000/svg")) {
      invalidHtml("Slide SVG namespace is invalid.");
    }
  }
  if (tag === "img" && !attributes.has("src")) {
    invalidHtml("Slide images require an approved src.");
  }
  return {
    elementId: attributes.get("data-element-id"),
    usedAssetStorageId,
  };
}

export function inspectSlideHtml(
  html: string,
  allowedAssetStorageIds: readonly string[] = [],
): HtmlInspection {
  const normalized = normalizeSvgPrimitiveElementIds(html.trim());
  if (new TextEncoder().encode(normalized).byteLength > MAX_HTML_BYTES) {
    invalidHtml("A slide exceeds the 100 KB HTML limit.");
  }
  if (!normalized || /<!doctype|<!--|<\/?(?:html|head|body|style|script|form|iframe|object|embed)\b/i.test(normalized)) {
    invalidHtml("Slide HTML contains a forbidden element.");
  }
  if (/\son[a-z]+\s*=|@import|url\s*\(|javascript:/i.test(normalized)) {
    invalidHtml("Slide HTML contains active or externally loaded content.");
  }

  const tokenPattern = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g;
  const stack: string[] = [];
  const elementIds = new Set<string>();
  let elementCount = 0;
  let rootSeen = false;
  const allowedAssets = new Set(allowedAssetStorageIds);
  const usedAssetStorageIds = new Set<string>();
  const elementIdIssues: ElementIdIssue[] = [];
  let cursor = 0;

  for (const match of normalized.matchAll(tokenPattern)) {
    const gap = normalized.slice(cursor, match.index);
    if (gap.includes("<")) invalidHtml("Slide HTML is malformed.");
    cursor = (match.index ?? 0) + match[0].length;
    const closing = match[1] === "/";
    const tag = match[2]?.toLowerCase() ?? "";
    const rawAttributes = match[3] ?? "";
    if (!ALLOWED_TAGS.has(tag)) invalidHtml(`Slide HTML tag '${tag}' is not allowed.`);

    if (closing) {
      if (VOID_TAGS.has(tag) || rawAttributes.trim() || stack.pop() !== tag) {
        invalidHtml("Slide HTML tags are not properly nested.");
      }
      continue;
    }

    elementCount += 1;
    if (elementCount > 250) invalidHtml("A slide contains too many elements.");
    const attributes = parseAttributes(rawAttributes);
    const validated = validateAttributes(tag, attributes, allowedAssets);
    if (validated.usedAssetStorageId) {
      usedAssetStorageIds.add(validated.usedAssetStorageId);
    }

    const isRoot = !rootSeen;
    if (isRoot) {
      rootSeen = true;
      if ((match.index ?? -1) !== 0 || (tag !== "div" && tag !== "section")) {
        invalidHtml("Each slide must have one div or section root.");
      }
      const classes = attributes.get("class")?.split(/\s+/) ?? [];
      if (!classes.includes("slide-root")) invalidHtml("Slide root must use class 'slide-root'.");
      const rootStyle = validateStyle(attributes.get("style") ?? "");
      if (
        rootStyle.get("position")?.replace(/\s/g, "").toLowerCase() !== "relative" ||
        rootStyle.get("width")?.replace(/\s/g, "").toLowerCase() !== "1280px" ||
        rootStyle.get("height")?.replace(/\s/g, "").toLowerCase() !== "720px"
      ) {
        invalidHtml("Slide root must be position:relative at exactly 1280×720 pixels.");
      }
    } else {
      if (stack.length === 0) {
        invalidHtml("Every slide element must be contained by the slide root.");
      }
      if ((attributes.get("class")?.split(/\s+/) ?? []).includes("slide-root")) {
        invalidHtml("Each slide may contain only one slide-root.");
      }
      if (tag !== "br" && !validated.elementId) {
        elementIdIssues.push({ kind: "missing", tag, elementIndex: elementCount });
      }
      if (validated.elementId) {
        if (elementIds.has(validated.elementId)) {
          elementIdIssues.push({
            kind: "duplicate",
            tag,
            elementIndex: elementCount,
            elementId: validated.elementId,
          });
        } else {
          elementIds.add(validated.elementId);
        }
      }
    }

    const selfClosing = /\/\s*$/.test(rawAttributes) || VOID_TAGS.has(tag);
    if (isRoot && selfClosing) invalidHtml("The slide root cannot be self-closing.");
    if (!selfClosing) {
      stack.push(tag);
      if (stack.length > 30) invalidHtml("Slide HTML is nested too deeply.");
    }
  }

  if (!rootSeen || stack.length > 0 || cursor !== normalized.length) {
    invalidHtml("Slide HTML must contain exactly one well-formed slide root.");
  }
  if (elementIdIssues.length > 0) {
    invalidHtml(describeElementIdIssues(elementIdIssues));
  }
  return { html: normalized, elementIds, usedAssetStorageIds };
}
