import type { GeneratedSlideLayoutIssue } from "./generated_layout_diagnostics";

const OPEN_TAG_PATTERN = /<([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g;

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
      declaration.slice(separator + 1).trim(),
    );
  }
  return declarations;
}

function pixel(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}

function serializeStyle(style: Map<string, string>): string {
  return Array.from(style.entries()).map(([name, value]) => `${name}:${value}`).join(";");
}

function replaceStyle(
  html: string,
  elementId: string,
  update: (style: Map<string, string>) => boolean,
): string | null {
  let changed = false;
  const output = html.replace(OPEN_TAG_PATTERN, (full, tag: string, rawAttributes: string) => {
    if (changed || attributeValue(rawAttributes, "data-element-id") !== elementId) return full;
    const styleMatch = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(rawAttributes);
    const currentStyle = styleMatch?.[1] ?? styleMatch?.[2] ?? "";
    const style = styleDeclarations(currentStyle);
    if (!update(style)) return full;
    const serialized = serializeStyle(style);
    const nextAttributes = styleMatch
      ? rawAttributes.replace(styleMatch[0], ` style="${serialized}"`)
      : `${rawAttributes.replace(/\s*\/$/, "")} style="${serialized}"${/\s*\/$/.test(rawAttributes) ? " /" : ""}`;
    changed = true;
    return `<${tag}${nextAttributes}>`;
  });
  return changed ? output : null;
}

function moveTop(html: string, elementId: string, y: number): string | null {
  return replaceStyle(html, elementId, (style) => {
    style.delete("bottom");
    style.set("top", pixel(y));
    return true;
  });
}

function repairWrappedOverflow(
  html: string,
  issue: Extract<GeneratedSlideLayoutIssue, { code: "wrapped_overflow" }>,
): string | null {
  const scale = Math.min(0.98, (issue.availableHeight / issue.requiredHeight) * 0.96);
  const newFontSize = issue.fontSize * scale;
  if (scale >= 0.75 && newFontSize >= 14) {
    return replaceStyle(html, issue.elementId, (style) => {
      style.set("font-size", pixel(newFontSize));
      style.set("line-height", pixel(issue.lineHeight * scale));
      style.set("height", pixel(issue.availableHeight));
      return true;
    });
  }
  const overflow = issue.requiredHeight - issue.availableHeight;
  const nextY = issue.bounds.y - overflow - 12;
  return nextY >= 0 ? moveTop(html, issue.elementId, nextY) : null;
}

function repairOverlap(
  html: string,
  issue: Extract<GeneratedSlideLayoutIssue, { code: "overlap" }>,
): string | null {
  const [first, second] = issue.bounds;
  const upper = first.y <= second.y ? first : second;
  const lower = upper === first ? second : first;
  const lowerY = upper.y + upper.height + 12;
  if (lowerY + lower.height <= lower.containerHeight) {
    return moveTop(html, lower.elementId, lowerY);
  }
  const upperY = lower.y - upper.height - 12;
  return upperY >= 0 ? moveTop(html, upper.elementId, upperY) : null;
}

function repairOutOfBounds(
  html: string,
  issue: Extract<GeneratedSlideLayoutIssue, { code: "out_of_bounds" }>,
): string | null {
  const bounds = issue.bounds;
  const width = Math.min(bounds.width, bounds.containerWidth);
  const height = Math.min(bounds.height, bounds.containerHeight);
  const x = Math.max(0, Math.min(bounds.x, bounds.containerWidth - width));
  const y = Math.max(0, Math.min(bounds.y, bounds.containerHeight - height));
  return replaceStyle(html, issue.elementId, (style) => {
    style.delete("right");
    style.delete("bottom");
    style.set("left", pixel(x));
    style.set("top", pixel(y));
    style.set("width", pixel(width));
    style.set("height", pixel(height));
    return true;
  });
}

export function applyDeterministicLayoutAutofix(
  html: string,
  issue: GeneratedSlideLayoutIssue,
): string | null {
  switch (issue.code) {
    case "wrapped_overflow":
      return repairWrappedOverflow(html, issue);
    case "overlap":
      return repairOverlap(html, issue);
    case "out_of_bounds":
      return repairOutOfBounds(html, issue);
    case "missing_size":
    case "missing_anchor":
      return null;
  }
}
