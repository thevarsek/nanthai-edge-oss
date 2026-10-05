import test from "node:test";
import assert from "node:assert/strict";
import { contextEvidenceCandidates, validateSourceEvidence, stripSourceEvidence } from "../chat/source_evidence";
import { recordMessageSource } from "../chat/message_provenance";
import type { OpenRouterMessage } from "../lib/openrouter";

test("only provided messages and selected, actually rendered memories can become sources", () => {
  const message: OpenRouterMessage = { role: "user", content: "The embedding is platform funded." };
  recordMessageSource(message, "earlier-1", null);
  const sources = contextEvidenceCandidates([message, { role: "system", content: "A helper is isolated." }],
    [{ _id: "memory-1", summary: "A helper is isolated." }, { _id: "memory-2", summary: "A helper is isolated." },
      { _id: "memory-3", summary: "Absent from context" }], ["memory-1", "memory-3"]);
  assert.deepEqual(sources.map(source => source.id), ["message:earlier-1", "memory:memory-1"]);
  const text = 'Helpers stay isolated. <SOURCE_CITATIONS>[{"sourceId":"memory:memory-1","quote":"helper is isolated","claim":"Helpers stay isolated."}]</SOURCE_CITATIONS>';
  assert.equal(validateSourceEvidence(text, sources).length, 1);
  assert.equal(stripSourceEvidence(text), "Helpers stay isolated.");
});
test("fabricated sources, fabricated quotes and unrelated claims add no evidence pill or response restriction", () => {
  const sources = [{ id: "message:1", kind: "message" as const, label: "Earlier message", text: "Known fact" }];
  for (const entry of [
    { sourceId: "invented", quote: "Known fact" }, { sourceId: "message:1", quote: "Invented fact" },
    { sourceId: "message:1", quote: "Known fact", claim: "A different answer" },
  ]) {
    const text = `Answer remains visible. <SOURCE_CITATIONS>${JSON.stringify([entry])}</SOURCE_CITATIONS>`;
    assert.deepEqual(validateSourceEvidence(text, sources), []);
    assert.equal(stripSourceEvidence(text), "Answer remains visible.");
  }
  assert.deepEqual(validateSourceEvidence("Answer with no citation block.", sources), []);
  assert.equal(stripSourceEvidence("Answer. <SOURCE_CITATIONS>[unfinished"), "Answer.");
});
