import {
  GeneratedSlideLayoutError,
  type GeneratedSlideLayoutIssue,
  type GeneratedTextBounds,
} from "./generated_layout_diagnostics";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const TEXT_TAGS = new Set(["h1", "h2", "h3", "p", "span"]);
const VOID_TAGS = new Set(["img", "br"]);
const TOKEN_PATTERN = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g;
export {
  GeneratedSlideLayoutError,
  type GeneratedSlideLayoutIssue,
  type GeneratedTextBounds,
} from "./generated_layout_diagnostics";

interface ContainingBlock {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextCandidate {
  allocatedWidth: number;
  bounds: GeneratedTextBounds;
  fontSize: number;
  lineHeight: number;
  textAlign: string;
}

interface OpenElement {
  containingBlock: ContainingBlock;
  contentStart: number;
  textCandidate?: TextCandidate;
}

interface TextMetrics {
  lineCount: number;
  width: number;
}

function attributeValue(rawAttributes: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = pattern.exec(rawAttributes);
  return match?.[1] ?? match?.[2];
}

function styleDeclarations(style: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const rawDeclaration of style.split(";")) {
    const declaration = rawDeclaration.trim();
    const separator = declaration.indexOf(":");
    if (separator <= 0) continue;
    declarations.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      declaration.slice(separator + 1).trim().toLowerCase(),
    );
  }
  return declarations;
}

function pixelValue(value: string | undefined): number | undefined {
  if (!value || !/^-?(?:\d+|\d*\.\d+)px$/.test(value)) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function relativePosition(
  style: ReadonlyMap<string, string>,
  width: number,
  height: number,
  container: ContainingBlock,
): { x: number; y: number } | undefined {
  const left = pixelValue(style.get("left"));
  const right = pixelValue(style.get("right"));
  const top = pixelValue(style.get("top"));
  const bottom = pixelValue(style.get("bottom"));
  if ((left === undefined && right === undefined) || (top === undefined && bottom === undefined)) {
    return undefined;
  }
  return {
    x: left ?? container.width - (right ?? 0) - width,
    y: top ?? container.height - (bottom ?? 0) - height,
  };
}

function textCandidate(rawAttributes: string, tag: string, parent: ContainingBlock): TextCandidate | undefined {
  if (!TEXT_TAGS.has(tag)) return undefined;
  const style = styleDeclarations(attributeValue(rawAttributes, "style") ?? "");
  if (style.get("position") !== "absolute") return undefined;
  const width = pixelValue(style.get("width"));
  const fontSize = pixelValue(style.get("font-size"));
  if (!width || width <= 0 || !fontSize || fontSize <= 0) return undefined;
  const allocatedHeight = pixelValue(style.get("height")) ?? fontSize * 1.2;
  const position = relativePosition(style, width, allocatedHeight, parent);
  if (!position) return undefined;
  const rawLineHeight = style.get("line-height");
  const multiplier = rawLineHeight && /^\d*\.?\d+$/.test(rawLineHeight)
    ? Number.parseFloat(rawLineHeight)
    : undefined;
  const lineHeight = pixelValue(rawLineHeight) ?? (multiplier ? fontSize * multiplier : fontSize * 1.2);
  return {
    allocatedWidth: width,
    bounds: {
      elementId: attributeValue(rawAttributes, "data-element-id") ?? tag,
      parentKey: parent.key,
      isTopLevel: parent.key === "slide-root",
      x: parent.x + position.x,
      y: parent.y + position.y,
      width: 0,
      height: 0,
      containerWidth: SLIDE_WIDTH,
      containerHeight: SLIDE_HEIGHT,
    },
    fontSize,
    lineHeight,
    textAlign: style.get("text-align") ?? "left",
  };
}

function lineMetrics(text: string, maxWidth: number, characterWidth: number): TextMetrics {
  const words = text.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lineCount: 1, width: 0 };
  let lineCount = 1;
  let lineWidth = 0;
  let widest = 0;
  for (const word of words) {
    const wordWidth = word.length * characterWidth;
    const nextWidth = lineWidth === 0 ? wordWidth : lineWidth + characterWidth + wordWidth;
    if (lineWidth > 0 && nextWidth > maxWidth) {
      widest = Math.max(widest, lineWidth);
      lineCount += 1;
      lineWidth = wordWidth;
    } else {
      lineWidth = nextWidth;
    }
  }
  return { lineCount, width: Math.max(widest, lineWidth) };
}

function estimatedTextMetrics(text: string, maxWidth: number, fontSize: number): TextMetrics {
  const characterWidth = fontSize * 0.48;
  return text.split(/<br\s*\/?>/gi).reduce<TextMetrics>((total, line) => {
    const metrics = lineMetrics(line, maxWidth, characterWidth);
    return {
      lineCount: total.lineCount + metrics.lineCount,
      width: Math.max(total.width, metrics.width),
    };
  }, { lineCount: 0, width: 0 });
}

function finalizeCandidate(candidate: TextCandidate, text: string): GeneratedSlideLayoutIssue | undefined {
  const metrics = estimatedTextMetrics(text, candidate.allocatedWidth, candidate.fontSize);
  candidate.bounds.width = metrics.width;
  candidate.bounds.height = metrics.lineCount * candidate.lineHeight;
  if (candidate.textAlign === "center") {
    candidate.bounds.x += (candidate.allocatedWidth - metrics.width) / 2;
  } else if (candidate.textAlign === "right" || candidate.textAlign === "end") {
    candidate.bounds.x += candidate.allocatedWidth - metrics.width;
  }
  const bounds = candidate.bounds;
  if (bounds.x >= 0 && bounds.y >= 0 &&
      bounds.x + bounds.width <= SLIDE_WIDTH && bounds.y + bounds.height <= SLIDE_HEIGHT) {
    return undefined;
  }
  const availableHeight = Math.max(0, SLIDE_HEIGHT - bounds.y);
  return {
    code: "wrapped_overflow",
    elementId: bounds.elementId,
    bounds: { ...bounds },
    requiredHeight: bounds.height,
    availableHeight,
    lineCount: metrics.lineCount,
    fontSize: candidate.fontSize,
    lineHeight: candidate.lineHeight,
    message: `Rendered text '${bounds.elementId}' extends beyond the 1280×720 canvas.`,
  };
}

function severeOverlap(left: GeneratedTextBounds, right: GeneratedTextBounds): boolean {
  const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (overlapWidth <= 8 || overlapHeight <= 4) return false;
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 && overlapArea / smallerArea >= 0.2;
}

function positionedContainingBlock(
  style: ReadonlyMap<string, string>,
  parent: ContainingBlock,
  key: string,
): ContainingBlock {
  const width = pixelValue(style.get("width")) ?? parent.width;
  const height = pixelValue(style.get("height")) ?? parent.height;
  const position = relativePosition(style, width, height, parent) ?? { x: 0, y: 0 };
  return { key, x: parent.x + position.x, y: parent.y + position.y, width, height };
}

export function validateGeneratedSlideLayoutIssues(html: string): GeneratedSlideLayoutIssue[] {
  const root: ContainingBlock = { key: "slide-root", x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
  const stack: OpenElement[] = [];
  const candidates: TextCandidate[] = [];
  const issues: GeneratedSlideLayoutIssue[] = [];
  let elementSequence = 0;
  for (const match of html.matchAll(TOKEN_PATTERN)) {
    const closing = match[1] === "/";
    const tag = match[2]?.toLowerCase() ?? "";
    const rawAttributes = match[3] ?? "";
    if (closing) {
      const opened = stack.pop();
      if (opened?.textCandidate) {
        const issue = finalizeCandidate(opened.textCandidate, html.slice(opened.contentStart, match.index));
        if (issue) issues.push(issue);
      }
      continue;
    }
    const parent = stack.at(-1)?.containingBlock ?? root;
    const candidate = stack.length > 0 ? textCandidate(rawAttributes, tag, parent) : undefined;
    if (candidate) candidates.push(candidate);
    const selfClosing = /\/\s*$/.test(rawAttributes) || VOID_TAGS.has(tag);
    if (!selfClosing) {
      const style = styleDeclarations(attributeValue(rawAttributes, "style") ?? "");
      const key = `${tag}-${elementSequence}`;
      const establishesBlock = style.get("position") !== undefined && style.get("position") !== "static";
      stack.push({
        containingBlock: establishesBlock ? positionedContainingBlock(style, parent, key) : parent,
        contentStart: (match.index ?? 0) + match[0].length,
        textCandidate: candidate,
      });
      elementSequence += 1;
    }
  }
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]?.bounds;
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]?.bounds;
      if (right && left.parentKey === right.parentKey && severeOverlap(left, right)) {
        issues.push({
          code: "overlap",
          elementIds: [left.elementId, right.elementId],
          bounds: [left, right],
          message: `Rendered text '${left.elementId}' and '${right.elementId}' severely overlaps.`,
        });
      }
    }
  }
  return issues;
}

export function validateGeneratedSlideLayout(html: string): void {
  const issues = validateGeneratedSlideLayoutIssues(html);
  if (issues.length > 0) throw new GeneratedSlideLayoutError(issues);
}
