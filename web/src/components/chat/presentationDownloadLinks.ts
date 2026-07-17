const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;

function isInternalPresentationDownload(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isConvexHost = parsed.hostname.endsWith(".convex.site") ||
      parsed.hostname.endsWith(".convex.cloud");
    const filename = parsed.searchParams.get("filename")?.toLowerCase();
    return isConvexHost && filename?.endsWith(".pptx") === true;
  } catch {
    return false;
  }
}

export function replaceInternalPresentationDownloadLinks(content: string): string {
  let replaced = false;
  const lines = content.split("\n").map((line) => {
    MARKDOWN_LINK_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
      const url = match[1];
      if (url && isInternalPresentationDownload(url)) {
        replaced = true;
        return "Open the presentation card below to view or download it.";
      }
    }
    return line;
  });
  if (!replaced) return content;
  return lines.filter((line, index) => {
    const nextNonEmptyLine = lines.slice(index + 1).find((candidate) => candidate.trim());
    if (
      /^\s*(?:you can\s+)?download\b.*\bhere:\s*$/i.test(line) &&
      nextNonEmptyLine === "Open the presentation card below to view or download it."
    ) return false;
    return line !== "Open the presentation card below to view or download it." ||
      lines.indexOf(line) === index;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
