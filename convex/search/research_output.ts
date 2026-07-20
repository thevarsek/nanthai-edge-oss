export interface ResearchSource {
  url: string;
  title: string;
}

const SOURCES_HEADING = /^#{1,6}\s+(?:sources|references|bibliography)\s*$/im;
const MARKDOWN_LINK = /\[([^\]\n]+)]\((https?:\/\/[^\s)]+)\)/g;
const MAX_SOURCE_APPENDIX_ENTRIES = 60;

export function finalizeResearchPaperOutput(content: string): {
  content: string;
  citations: ResearchSource[];
} {
  const citations = extractResearchSources(content);
  if (citations.length === 0 || SOURCES_HEADING.test(content)) {
    return { content, citations };
  }

  const appendix = citations
    .slice(0, MAX_SOURCE_APPENDIX_ENTRIES)
    .map((citation) => `- [${citation.title}](${citation.url})`)
    .join("\n");
  return {
    content: `${content.trimEnd()}\n\n## Sources\n\n${appendix}`,
    citations,
  };
}

export function extractResearchSources(content: string): ResearchSource[] {
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    const title = match[1]?.trim();
    const url = match[2]?.trim();
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title, url });
  }
  return sources;
}
