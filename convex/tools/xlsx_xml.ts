export function escapeXlsxXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function unescapeXlsxXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function getXlsxAttribute(element: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = element.match(new RegExp(`(?:^|\\s)${escaped}=["']([^"']*)["']`));
  return match ? unescapeXlsxXml(match[1]) : null;
}

export function getXlsxElements(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<${escaped}(?=[\\s>/])[^>]*(?:/>|>[\\s\\S]*?<\\/${escaped}>)`,
    "g",
  );
  return xml.match(expression) ?? [];
}

export function getXlsxInnerXml(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?=[\\s>])[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  return match?.[1] ?? null;
}

export function getXlsxText(xml: string, tag: string): string {
  const inner = getXlsxInnerXml(xml, tag);
  if (inner === null) return "";
  return unescapeXlsxXml(inner.replace(/<[^>]+>/g, ""));
}

export function replaceXlsxAttribute(
  element: string,
  attribute: string,
  value: string,
): string {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`(${escapedAttribute}=)["'][^"']*["']`);
  if (expression.test(element)) {
    return element.replace(expression, `$1"${escapeXlsxXml(value)}"`);
  }
  const end = element.indexOf(">");
  if (end < 0) return element;
  const insertion = element[end - 1] === "/" ? end - 1 : end;
  return `${element.slice(0, insertion)} ${attribute}="${escapeXlsxXml(value)}"${element.slice(insertion)}`;
}
