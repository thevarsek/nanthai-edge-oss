"use node";

import { paragraphText, type XmlNode } from "./docx_tracked_changes_xml";
import type { DocxEditError, ParagraphEdit, ProposedDocxEdit } from "./docx_tracked_changes_types";

function normalizeChar(char: string): string {
  if (/[\u200b-\u200d\ufeff]/u.test(char)) return "";
  if (/\s/u.test(char) || char === "\u00a0") return " ";
  return char
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[–—]/gu, "-")
    .toLowerCase();
}

function normalizeWithMap(text: string): { text: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const next = normalizeChar(text[index] ?? "");
    if (!next) continue;
    if (next === " ") {
      if (lastWasSpace) continue;
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    normalized += next;
    map.push(index);
  }

  let start = 0;
  let end = normalized.length;
  while (start < end && normalized[start] === " ") start += 1;
  while (end > start && normalized[end - 1] === " ") end -= 1;
  return { text: normalized.slice(start, end), map: map.slice(start, end) };
}

function findAll(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const hits: number[] = [];
  let offset = 0;
  while (offset <= haystack.length) {
    const hit = haystack.indexOf(needle, offset);
    if (hit < 0) break;
    hits.push(hit);
    offset = hit + Math.max(needle.length, 1);
  }
  return hits;
}

function originalIndexForBoundary(text: string, normalized: { map: number[] }, position: number): number {
  const mapped = normalized.map[position];
  if (mapped !== undefined) return mapped;
  const previous = normalized.map[position - 1];
  if (previous !== undefined) return previous + 1;
  return text.length;
}

function locateEdit(text: string, edit: ProposedDocxEdit): { start: number; end: number; ambiguous: boolean } | null {
  const normalized = normalizeWithMap(text);
  const find = normalizeWithMap(edit.find).text;
  const before = normalizeWithMap(edit.contextBefore).text;
  const after = normalizeWithMap(edit.contextAfter).text;
  if (!find) {
    const positions: number[] = [];
    if (before) {
      for (const hit of findAll(normalized.text, before)) positions.push(hit + before.length);
    } else if (after) {
      for (const hit of findAll(normalized.text, after)) positions.push(hit);
    }
    const unique = [...new Set(positions)];
    if (unique.length !== 1) return unique.length > 1 ? { start: 0, end: 0, ambiguous: true } : null;
    const original = originalIndexForBoundary(text, normalized, unique[0]!);
    return { start: original, end: original, ambiguous: false };
  }

  const hits = findAll(normalized.text, find).filter((hit) => {
    const prefixOk = before ? normalized.text.slice(0, hit).trimEnd().endsWith(before) : true;
    const suffixStart = hit + find.length;
    const suffixOk = after ? normalized.text.slice(suffixStart).trimStart().startsWith(after) : true;
    return prefixOk && suffixOk;
  });
  if (hits.length !== 1) return hits.length > 1 ? { start: 0, end: 0, ambiguous: true } : null;
  const start = normalized.map[hits[0]] ?? 0;
  const end = (normalized.map[hits[0] + find.length - 1] ?? start) + 1;
  return { start, end, ambiguous: false };
}

export function locateParagraphEdits(
  paragraphs: XmlNode[],
  edits: ProposedDocxEdit[],
): { byParagraph: Map<XmlNode, ParagraphEdit[]>; errors: DocxEditError[] } {
  const errors: DocxEditError[] = [];
  const byParagraph = new Map<XmlNode, ParagraphEdit[]>();
  edits.forEach((edit, index) => {
    if (!edit.find && !edit.replace) errors.push({ index, code: "EMPTY_EDIT", message: "find and replace cannot both be empty." });
    if (!edit.find && !edit.contextBefore && !edit.contextAfter) errors.push({ index, code: "PURE_INSERT_REQUIRES_CONTEXT", message: "Pure insertions require before or after context." });
    if (errors.some((error) => error.index === index)) return;
    const matches = paragraphs.map((paragraph) => ({ paragraph, located: locateEdit(paragraphText(paragraph), edit) })).filter((match) => match.located);
    if (matches.some((match) => match.located?.ambiguous) || matches.length > 1) errors.push({ index, code: "MATCH_AMBIGUOUS", message: "Edit matched more than one location. Use longer context anchors." });
    else if (matches.length === 0) errors.push({ index, code: "MATCH_NOT_FOUND", message: "Edit text/context was not found in the document body." });
    else {
      const match = matches[0]!;
      const located = match.located!;
      const group = byParagraph.get(match.paragraph) ?? [];
      group.push({ ...edit, index, start: located.start, end: located.end });
      byParagraph.set(match.paragraph, group);
    }
  });
  return { byParagraph, errors };
}
