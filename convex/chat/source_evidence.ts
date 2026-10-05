import { v } from "convex/values";
import type { EvidenceCandidate } from "./source_evidence_quotes";
export { stripSourceEvidence, validateSourceEvidence } from "./source_evidence_quotes";
export type { EvidenceCandidate, SourceCitation } from "./source_evidence_quotes";
import type { OpenRouterMessage } from "../lib/openrouter";
import { messageSources } from "./message_provenance";

export const evidenceCandidateValidator = v.object({ id: v.string(), kind: v.union(v.literal("message"), v.literal("memory"), v.literal("document"), v.literal("native_file")), label: v.string(), text: v.string() });
export const sourceCitationValidator = v.object({ sourceId: v.string(), kind: v.string(), label: v.string(), quote: v.string(), claim: v.optional(v.string()) });
function text(message: OpenRouterMessage): string {
  return typeof message.content === "string" ? message.content
    : (message.content ?? []).flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
}
export function contextEvidenceCandidates(
  messages: OpenRouterMessage[],
  memories: Array<{ _id: string; summary: string }>,
  memoryIds: string[],
  sharedMemorySources: readonly EvidenceCandidate[] = [],
): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  const body = messages.map(text).join("\n");
  messages.forEach((message, index) => {
    const content = text(message);
    for (const source of messageSources(message)) {
      if (!source.text || !content.includes(source.text)) continue;
      candidates.push({ id: `message:${source.messageId}`, kind: "message",
        label: `Message ${index + 1}: ${source.text.slice(0, 80)}`, text: source.text });
    }
  });
  for (const memory of memories) {
    if (memoryIds.includes(memory._id) && memory.summary.trim() && body.includes(memory.summary)) {
      candidates.push({ id: `memory:${memory._id}`, kind: "memory", label: memory.summary.slice(0, 80), text: memory.summary });
    }
  }
  for (const source of sharedMemorySources) {
    if (source.kind === "memory" && source.text.trim() && body.includes(source.text)) {
      candidates.push(source);
    }
  }
  return [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
}
export function sourceEvidencePrompt(candidates: EvidenceCandidate[]): string {
  if (!candidates.length) return "";
  return `[NanthAI supporting sources]\n${candidates.map(candidate => `${candidate.id}: ${candidate.kind === "message" ? JSON.stringify(candidate.label) : `Shared memory: ${JSON.stringify(candidate.label)}`}`).join("\n")}\nIf a claim in your answer relies on one of these provided sources, append <SOURCE_CITATIONS>[{"sourceId":"the exact source ID","quote":"an exact supporting excerpt","claim":"the supported sentence in your answer"}]</SOURCE_CITATIONS>. Cite only sources you actually used; omit the block when none supports the answer. This records supporting passages, not internal reasoning. Continue using document citations for scoped documents.`;
}
