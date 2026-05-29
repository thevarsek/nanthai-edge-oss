"use node";

import { builder, collectParagraphs, extractAcceptedParagraphs, extractReviewParagraphs, loadDocumentXml, type XmlNode } from "./docx_tracked_changes_xml";
import { locateParagraphEdits } from "./docx_tracked_changes_locator";
import { maxTrackedId, rewriteParagraph } from "./docx_tracked_changes_rewrite";
import type { AppliedDocxChange, DocxEditError, ProposedDocxEdit } from "./docx_tracked_changes_types";

export type { AppliedDocxChange, DocxEditError, ProposedDocxEdit } from "./docx_tracked_changes_types";
export { resolveTrackedDocxChange } from "./docx_tracked_changes_resolve";

export async function applyTrackedDocxEdits(
  bytes: ArrayBuffer,
  edits: ProposedDocxEdit[],
  opts: { author: string; now?: number; seed?: string },
): Promise<{ bytes: ArrayBuffer; changes: AppliedDocxChange[]; errors: DocxEditError[] }> {
  const { zip, path, tree } = await loadDocumentXml(bytes);
  const paragraphs: XmlNode[] = [];
  collectParagraphs(tree, paragraphs);
  const { byParagraph, errors } = locateParagraphEdits(paragraphs, edits);
  for (const [paragraph, group] of byParagraph.entries()) {
    group.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < group.length; i += 1) {
      if (group[i]!.start < group[i - 1]!.end) {
        errors.push({ index: group[i]!.index, code: "OVERLAPPING_EDIT", message: "Two proposed edits overlap in the same paragraph." });
      }
    }
    byParagraph.set(paragraph, group.filter((edit) => !errors.some((error) => error.index === edit.index)));
  }

  let next = maxTrackedId(tree) + 1;
  const date = new Date(opts.now ?? Date.now()).toISOString();
  const nextId = () => String(next++);
  const changes: AppliedDocxChange[] = [];
  for (const [paragraph, group] of byParagraph.entries()) {
    const rewritten = rewriteParagraph(paragraph, group, { author: opts.author, date, seed: opts.seed ?? path, nextId });
    changes.push(...rewritten.changes);
    errors.push(...rewritten.errors);
  }
  if (changes.length === 0) return { bytes, changes: [], errors };
  zip.file(path, builder.build(tree));
  return { bytes: await zip.generateAsync({ type: "arraybuffer" }), changes, errors };
}

export async function extractAcceptedDocxText(bytes: ArrayBuffer | Uint8Array): Promise<{ paragraphs: string[]; text: string; wordCount: number }> {
  const accepted = await extractAcceptedParagraphs(bytes);
  return {
    paragraphs: accepted.paragraphs.map((paragraph) => paragraph.text),
    text: accepted.text,
    wordCount: accepted.wordCount,
  };
}

export { extractAcceptedParagraphs as extractAcceptedDocxParagraphs };
export { extractReviewParagraphs as extractReviewDocxParagraphs };
