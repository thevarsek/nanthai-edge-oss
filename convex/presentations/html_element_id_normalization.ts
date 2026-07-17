const SVG_PRIMITIVE_TAGS = new Set(["path", "line", "rect", "circle"]);
const TOKEN_PATTERN = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g;
const ELEMENT_ID_PATTERN = /\sdata-element-id\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function existingElementIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(ELEMENT_ID_PATTERN)) {
    const id = match[1] ?? match[2];
    if (id) ids.add(id);
  }
  return ids;
}

function nextPrimitiveId(tag: string, counts: Map<string, number>, usedIds: Set<string>): string {
  let ordinal = (counts.get(tag) ?? 0) + 1;
  let candidate = `svg-${tag}-${ordinal}`;
  while (usedIds.has(candidate)) {
    ordinal += 1;
    candidate = `svg-${tag}-${ordinal}`;
  }
  counts.set(tag, ordinal);
  usedIds.add(candidate);
  return candidate;
}

/**
 * SVG leaf geometry is not individually meaningful to the model most of the
 * time, but the editor still needs stable identifiers. Assign deterministic
 * document-order IDs without changing any model-provided identifier.
 */
export function normalizeSvgPrimitiveElementIds(html: string): string {
  const usedIds = existingElementIds(html);
  const counts = new Map<string, number>();
  return html.replace(TOKEN_PATTERN, (token, closing: string, rawTag: string, rawAttributes: string) => {
    const tag = rawTag.toLowerCase();
    if (closing || !SVG_PRIMITIVE_TAGS.has(tag) || /\sdata-element-id\s*=/i.test(rawAttributes)) {
      return token;
    }
    const elementId = nextPrimitiveId(tag, counts, usedIds);
    const selfClosing = /\/\s*$/.test(rawAttributes);
    const attributes = selfClosing
      ? rawAttributes.replace(/\/\s*$/, ` data-element-id="${elementId}" /`)
      : `${rawAttributes} data-element-id="${elementId}"`;
    return `<${rawTag}${attributes}>`;
  });
}
