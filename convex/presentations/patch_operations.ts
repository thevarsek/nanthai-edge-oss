import { inspectSlideHtml } from "./html_contract";
import { presentationError } from "./limits";
import type { PresentationPatchOperation } from "./types";

interface ElementRange {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  tag: string;
}

const PATCHABLE_ATTRIBUTES = new Set([
  "class", "style", "aria-label", "role", "src", "alt", "viewbox", "d",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "opacity", "transform", "preserveaspectratio",
  "fill-opacity", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
]);

function invalidPatch(message: string): never {
  throw presentationError("MODEL_RESPONSE_INVALID", message);
}

function findElementRange(html: string, targetElementId: string): ElementRange | undefined {
  const tokenPattern = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g;
  const stack: Array<{
    tag: string;
    elementId?: string;
    start: number;
    openEnd: number;
  }> = [];
  for (const match of html.matchAll(tokenPattern)) {
    const closing = match[1] === "/";
    const tag = match[2]?.toLowerCase();
    if (!tag || match.index === undefined) continue;
    const tokenEnd = match.index + match[0].length;
    if (closing) {
      const opened = stack.pop();
      if (!opened || opened.tag !== tag) return undefined;
      if (opened.elementId === targetElementId) {
        return {
          start: opened.start,
          openEnd: opened.openEnd,
          closeStart: match.index,
          end: tokenEnd,
          tag,
        };
      }
      continue;
    }
    const rawAttributes = match[3] ?? "";
    const idMatch = rawAttributes.match(
      /\sdata-element-id\s*=\s*(?:"([^"]+)"|'([^']+)')/i,
    );
    const elementId = idMatch?.[1] ?? idMatch?.[2];
    const selfClosing = /\/\s*$/.test(rawAttributes) || tag === "img";
    if (selfClosing) {
      if (elementId === targetElementId) {
        return {
          start: match.index,
          openEnd: tokenEnd,
          closeStart: tokenEnd,
          end: tokenEnd,
          tag,
        };
      }
    } else {
      stack.push({ tag, elementId, start: match.index, openEnd: tokenEnd });
    }
  }
  return undefined;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setOpeningAttribute(
  html: string,
  range: ElementRange,
  name: string,
  value: string,
): string {
  const normalizedName = name.toLowerCase();
  if (!PATCHABLE_ATTRIBUTES.has(normalizedName) || /["'<>&]/.test(value)) {
    invalidPatch(`The AI edit tried to set an invalid '${name}' attribute.`);
  }
  const opening = html.slice(range.start, range.openEnd);
  const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\s${escapedName}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  const replaced = pattern.test(opening)
    ? opening.replace(pattern, `$1"${value}"`)
    : opening.replace(/\s*\/?>$/, (ending) => ` ${normalizedName}="${value}"${ending}`);
  return `${html.slice(0, range.start)}${replaced}${html.slice(range.openEnd)}`;
}

function applyOperation(html: string, operation: PresentationPatchOperation): string {
  const range = findElementRange(html, operation.elementId);
  if (!range) invalidPatch(`The AI edit targeted missing element ${operation.elementId}.`);
  switch (operation.op) {
    case "replace_text":
      if (range.tag === "img") invalidPatch("Image elements cannot receive text patches.");
      return `${html.slice(0, range.openEnd)}${escapeText(operation.text)}${html.slice(range.closeStart)}`;
    case "set_style":
      return setOpeningAttribute(html, range, "style", operation.style);
    case "set_attribute":
      return setOpeningAttribute(html, range, operation.name, operation.value);
    case "replace_element":
      return `${html.slice(0, range.start)}${operation.html}${html.slice(range.end)}`;
    case "insert_before":
      return `${html.slice(0, range.start)}${operation.html}${html.slice(range.start)}`;
    case "insert_after":
      return `${html.slice(0, range.end)}${operation.html}${html.slice(range.end)}`;
    case "append_child":
      if (range.tag === "img") invalidPatch("Image elements cannot receive child patches.");
      return `${html.slice(0, range.closeStart)}${operation.html}${html.slice(range.closeStart)}`;
  }
}

function normalizedOutsideTarget(html: string, targetElementId: string): string {
  const range = findElementRange(html, targetElementId);
  if (!range) invalidPatch(`The selected element ${targetElementId} was not found.`);
  return `${html.slice(0, range.start)}<presentation-edit-target/>${html.slice(range.end)}`
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyPresentationPatch(args: {
  currentHtml: string;
  operations: PresentationPatchOperation[];
  allowedAssetStorageIds: readonly string[];
  targetElementId?: string;
}): string {
  if (args.operations.length === 0) {
    invalidPatch("The AI edit returned no patch operations.");
  }
  if (args.targetElementId) {
    const invalidTarget = args.operations.find((operation) =>
      operation.elementId !== args.targetElementId ||
      operation.op === "insert_before" || operation.op === "insert_after"
    );
    if (invalidTarget) {
      invalidPatch(`The AI edit changed content outside ${args.targetElementId}.`);
    }
  }
  const current = inspectSlideHtml(args.currentHtml, args.allowedAssetStorageIds);
  const patchedHtml = args.operations.reduce(applyOperation, current.html);
  const patched = inspectSlideHtml(patchedHtml, args.allowedAssetStorageIds);
  for (const elementId of current.elementIds) {
    if (!patched.elementIds.has(elementId)) {
      invalidPatch(`The AI edit removed stable element ${elementId}.`);
    }
  }
  if (args.targetElementId &&
      normalizedOutsideTarget(current.html, args.targetElementId) !==
      normalizedOutsideTarget(patched.html, args.targetElementId)) {
    invalidPatch(`The AI edit changed content outside ${args.targetElementId}.`);
  }
  return patched.html;
}
