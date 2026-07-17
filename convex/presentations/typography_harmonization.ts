import type {
  PresentationTypographyRoles,
  PresentationTypographyToken,
} from "./types";

const ROLE_TO_TOKEN = {
  "display-title": "displayTitle",
  "slide-title": "slideTitle",
  body: "body",
  label: "label",
  kicker: "kicker",
  "sequence-number": "sequenceNumber",
  footer: "footer",
} as const;

type TypographyRole = keyof typeof ROLE_TO_TOKEN;
type TypographyTokenKey = typeof ROLE_TO_TOKEN[TypographyRole];

const OPENING_TEXT_TAG = /<(h1|h2|h3|p|span|div)\b([^<>]*)>/gi;
const SAFE_FONT_FAMILY = /^[A-Za-z0-9 ,_-]{1,120}$/;

function readAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = attributes.match(pattern);
  return match?.[1] ?? match?.[2];
}

function explicitRole(attributes: string): TypographyRole | undefined {
  const value = readAttribute(attributes, "data-element-role");
  return value && value in ROLE_TO_TOKEN ? value as TypographyRole : undefined;
}

function inferredRole(tag: string, attributes: string): TypographyRole | undefined {
  const elementId = readAttribute(attributes, "data-element-id")?.toLowerCase();
  if (!elementId) return undefined;
  const token = (pattern: string) => new RegExp(`(?:^|[-_])(?:${pattern})(?:[-_]|$)`).test(elementId);
  if (/^h[1-3]$/.test(tag) && token("title|headline|heading")) return "slide-title";
  if (token("kicker|eyebrow|overline")) return "kicker";
  if (token("sequence|slide-number|section-number|number|numeral|counter|index|num")) {
    return "sequence-number";
  }
  if (token("footer|source|sources")) return "footer";
  return undefined;
}

function safeToken(token: PresentationTypographyToken): PresentationTypographyToken | undefined {
  const fontFamily = token.fontFamily.trim();
  const fontWeight = token.fontWeight;
  if (!SAFE_FONT_FAMILY.test(fontFamily) || !Number.isInteger(fontWeight) ||
      fontWeight < 100 || fontWeight > 900 || fontWeight % 100 !== 0) return undefined;
  return { fontFamily, fontWeight };
}

function replaceStyleProperty(style: string, property: string, value: string): string {
  const declarations = style.split(";").map((entry) => entry.trim()).filter(Boolean);
  const prefix = `${property}:`;
  const index = declarations.findIndex((entry) => entry.toLowerCase().startsWith(prefix));
  const replacement = `${property}:${value}`;
  if (index >= 0) declarations[index] = replacement;
  else declarations.push(replacement);
  return declarations.join(";");
}

function writeStyle(attributes: string, token: PresentationTypographyToken): string {
  const stylePattern = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i;
  const match = attributes.match(stylePattern);
  const current = match?.[2] ?? match?.[3] ?? "";
  const withFamily = replaceStyleProperty(current, "font-family", token.fontFamily);
  const next = replaceStyleProperty(withFamily, "font-weight", String(token.fontWeight));
  if (!match) return `${attributes} style="${next}"`;
  const quote = match[1]?.startsWith("'") ? "'" : '"';
  return attributes.replace(stylePattern, ` style=${quote}${next}${quote}`);
}

export function harmonizePresentationTypography(
  html: string,
  roles?: PresentationTypographyRoles,
): string {
  if (!roles) return html;
  return html.replace(OPENING_TEXT_TAG, (opening, rawTag: string, attributes: string) => {
    const role = explicitRole(attributes) ?? inferredRole(rawTag.toLowerCase(), attributes);
    if (!role) return opening;
    const key: TypographyTokenKey = ROLE_TO_TOKEN[role];
    const token = safeToken(roles[key]);
    return token ? `<${rawTag}${writeStyle(attributes, token)}>` : opening;
  });
}
