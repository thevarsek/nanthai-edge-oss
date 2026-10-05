export type EvidenceCandidate = { id: string; kind: "message" | "memory" | "document" | "native_file"; label: string; text: string };
export type SourceCitation = { sourceId: string; kind: string; label: string; quote: string; claim?: string };
export function stripSourceEvidence(content: string): string {
  return content.replace(/<SOURCE_CITATIONS>[\s\S]*?<\/SOURCE_CITATIONS>/g, "").replace(/<SOURCE_CITATIONS>[\s\S]*$/g, "").trimEnd();
}
export function validateSourceEvidence(content: string, candidates: readonly EvidenceCandidate[]): SourceCitation[] {
  const matches = [...content.matchAll(/<SOURCE_CITATIONS>([\s\S]*?)<\/SOURCE_CITATIONS>/g)];
  const citations: SourceCitation[] = [];
  const answer = normalize(stripSourceEvidence(content));
  for (const match of matches) {
    let entries: unknown;
    try { entries = JSON.parse(match[1] ?? ""); } catch { continue; }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !("sourceId" in entry) || typeof entry.sourceId !== "string"
        || !("quote" in entry) || typeof entry.quote !== "string" || !entry.quote.trim()) continue;
      const claim = "claim" in entry && typeof entry.claim === "string" ? entry.claim : undefined;
      const source = candidates.find(candidate => candidate.id === entry.sourceId);
      if (!source || !normalize(source.text).includes(normalize(entry.quote))) continue;
      if (claim && !answer.includes(normalize(claim))) continue;
      const citation = { sourceId: source.id, kind: source.kind, label: source.label, quote: entry.quote,
        ...(claim ? { claim } : {}) };
      if (!citations.some(existing => existing.sourceId === citation.sourceId && existing.quote === citation.quote)) citations.push(citation);
    }
  }
  return citations;
}
function normalize(value: string): string { return value.normalize("NFKC").replace(/\s+/g, " ").trim(); }
