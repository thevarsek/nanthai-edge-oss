const PLACEHOLDER_CHAT_TITLES = new Set([
  "new conversation",
  "new chat",
  "welcome to nanthai edge",
]);

export function isPlaceholderTitle(title?: string | null): boolean {
  const normalized = (title ?? "").trim().toLowerCase();
  return normalized.length === 0 || PLACEHOLDER_CHAT_TITLES.has(normalized);
}

export function buildSeedTitle(source: string): string {
  return source
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .trim();
}

export function normalizedGeneratedTitle(rawTitle: string): string {
  let title = rawTitle.trim();
  title = title.replace(/^["'`]|["'`]$/g, "");
  title = title.split("\n")[0].trim();
  return title;
}

export function fallbackTitleFromSource(
  sourceContent: string,
  assistantContent?: string,
): string {
  const primary = sourceContent.trim();
  const secondary = assistantContent?.trim() ?? "";
  const seed = primary.length > 0 ? primary : secondary;
  if (!seed) return "";
  return buildSeedTitle(seed);
}
