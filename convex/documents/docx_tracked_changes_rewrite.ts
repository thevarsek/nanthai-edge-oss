"use node";

import { attrs, children, nodeName, readTextNodes, type XmlArray, type XmlNode } from "./docx_tracked_changes_xml";
import type { AppliedDocxChange, DocxEditError, ParagraphEdit, ParagraphEntry, ProposedDocxEdit } from "./docx_tracked_changes_types";

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

function formattedTextRun(text: string, deleted: boolean, runProperties?: XmlNode): XmlNode[] {
  if (!text) return [];
  const pieces = text.split("\n");
  const runChildren: XmlArray = [];
  if (runProperties) runChildren.push(cloneNode(runProperties));
  pieces.forEach((piece, index) => {
    if (index > 0) runChildren.push({ "w:br": [] });
    const tag = deleted ? "w:delText" : "w:t";
    runChildren.push({ [tag]: [{ "#text": piece }], ":@": { "xml:space": "preserve" } });
  });
  return [{ "w:r": runChildren }];
}

function wrappedChange(
  tag: "w:del" | "w:ins",
  id: string,
  changeId: string,
  author: string,
  date: string,
  runs: XmlNode[],
): XmlNode {
  return {
    [tag]: runs,
    ":@": {
      "w:id": id,
      "w:author": author,
      "w:date": date,
      "nanthai:changeId": changeId,
    },
  };
}

export function maxTrackedId(nodes: XmlArray): number {
  let max = 0;
  for (const node of nodes) {
    const name = nodeName(node);
    if (name === "w:ins" || name === "w:del") {
      const parsed = Number.parseInt(attrs(node)["w:id"] ?? "0", 10);
      if (Number.isFinite(parsed)) max = Math.max(max, parsed);
    }
    const inner = children(node);
    if (inner) max = Math.max(max, maxTrackedId(inner));
  }
  return max;
}

function changeIdFor(seed: string, index: number, edit: ProposedDocxEdit): string {
  const input = `${seed}\n${index}\n${edit.find}\n${edit.replace}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return `docx-change-${hex}-${index}`;
}

function textFromNode(node: XmlNode, visible = true): string {
  const parts: string[] = [];
  readTextNodes([node], visible, parts);
  return parts.join("");
}

function runProperties(run: XmlNode): XmlNode | undefined {
  return (children(run) ?? []).find((child) => nodeName(child) === "w:rPr");
}

function runTextAndSupport(run: XmlNode): { text: string; supported: boolean } {
  let text = "";
  let supported = true;
  for (const child of children(run) ?? []) {
    const name = nodeName(child);
    if (name === "w:rPr") continue;
    if (name === "w:t" || name === "w:delText") {
      const textNode = (children(child) ?? []).find((item) => Object.hasOwn(item, "#text"));
      text += String(textNode?.["#text"] ?? "");
    } else if (name === "w:br") {
      text += "\n";
    } else if (name === "w:tab") {
      text += "\t";
    } else {
      supported = false;
      text += textFromNode(child);
    }
  }
  return { text, supported };
}

function paragraphEntries(paragraph: XmlNode): { entries: ParagraphEntry[]; text: string } {
  const entries: ParagraphEntry[] = [];
  let text = "";
  for (const child of children(paragraph) ?? []) {
    const name = nodeName(child);
    const position = text.length;
    if (name === "w:r") {
      const run = runTextAndSupport(child);
      if (run.text.length === 0) {
        entries.push({ kind: "node", node: child, position, name });
      } else if (run.supported) {
        entries.push({ kind: "run", node: child, start: position, end: position + run.text.length, text: run.text, runProperties: runProperties(child) });
        text += run.text;
      } else {
        entries.push({ kind: "unsupportedText", node: child, start: position, end: position + run.text.length, text: run.text, name });
        text += run.text;
      }
    } else if (name === "w:del") {
      entries.push({ kind: "node", node: child, position, name });
    } else {
      const childText = textFromNode(child);
      if (childText.length > 0 && name !== "w:pPr") {
        entries.push({ kind: "unsupportedText", node: child, start: position, end: position + childText.length, text: childText, name });
        text += childText;
      } else {
        entries.push({ kind: "node", node: child, position, name });
      }
    }
  }
  return { entries, text };
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function editTouchesUnsupported(entries: ParagraphEntry[], edit: ParagraphEdit): boolean {
  for (const entry of entries) {
    if (entry.kind === "unsupportedText") {
      if (edit.start === edit.end) {
        if (edit.start > entry.start && edit.start < entry.end) return true;
      } else if (rangesOverlap(edit.start, edit.end, entry.start, entry.end)) {
        return true;
      }
    }
    if (entry.kind === "node" && entry.name !== "w:pPr" && edit.start < entry.position && entry.position < edit.end) {
      return true;
    }
  }
  return false;
}

function runEntries(entries: ParagraphEntry[]): Extract<ParagraphEntry, { kind: "run" }>[] {
  return entries.filter((entry): entry is Extract<ParagraphEntry, { kind: "run" }> => entry.kind === "run");
}

function formattedRunsForRange(entries: ParagraphEntry[], start: number, end: number, deleted: boolean): XmlNode[] {
  const runs: XmlNode[] = [];
  for (const entry of runEntries(entries)) {
    if (!rangesOverlap(start, end, entry.start, entry.end)) continue;
    const from = Math.max(start, entry.start) - entry.start;
    const to = Math.min(end, entry.end) - entry.start;
    runs.push(...formattedTextRun(entry.text.slice(from, to), deleted, entry.runProperties));
  }
  return runs;
}

function formattingForInsertion(entries: ParagraphEntry[], position: number): XmlNode | undefined {
  const runs = runEntries(entries);
  const containing = runs.find((entry) => position > entry.start && position < entry.end);
  if (containing) return containing.runProperties;
  const previous = [...runs].reverse().find((entry) => entry.end <= position);
  if (previous) return previous.runProperties;
  return runs.find((entry) => entry.start >= position)?.runProperties;
}

function insertionRuns(entries: ParagraphEntry[], edit: ParagraphEdit): XmlNode[] {
  if (!edit.replace) return [];
  const deletedRuns = edit.start < edit.end ? runEntries(entries).find((entry) => rangesOverlap(edit.start, edit.end, entry.start, entry.end)) : undefined;
  return formattedTextRun(edit.replace, false, deletedRuns?.runProperties ?? formattingForInsertion(entries, edit.start));
}

function runEntryTouched(entry: Extract<ParagraphEntry, { kind: "run" }>, edits: ParagraphEdit[]): boolean {
  return edits.some((edit) => {
    if (edit.start === edit.end) return edit.start > entry.start && edit.start < entry.end;
    return rangesOverlap(edit.start, edit.end, entry.start, entry.end);
  });
}

export function rewriteParagraph(
  paragraph: XmlNode,
  edits: ParagraphEdit[],
  opts: { author: string; date: string; seed: string; nextId: () => string },
): { changes: AppliedDocxChange[]; errors: DocxEditError[] } {
  const { entries, text } = paragraphEntries(paragraph);
  const rebuilt: XmlArray = [];
  const changes: AppliedDocxChange[] = [];
  const errors: DocxEditError[] = [];
  const validEdits = edits.filter((edit) => {
    if (!editTouchesUnsupported(entries, edit)) return true;
    errors.push({ index: edit.index, code: "UNSUPPORTED_DOCX", message: "Edit intersects existing tracked changes or rich inline DOCX structures that cannot be preserved safely." });
    return false;
  });

  let editIndex = 0;
  let skipUntil = -1;
  const appendEdit = (edit: ParagraphEdit) => {
    const deletedText = text.slice(edit.start, edit.end);
    const changeId = changeIdFor(opts.seed, edit.index, edit);
    let delWId: string | undefined;
    let insWId: string | undefined;
    if (deletedText) {
      delWId = opts.nextId();
      rebuilt.push(wrappedChange("w:del", delWId, changeId, opts.author, opts.date, formattedRunsForRange(entries, edit.start, edit.end, true)));
    }
    if (edit.replace) {
      insWId = opts.nextId();
      rebuilt.push(wrappedChange("w:ins", insWId, changeId, opts.author, opts.date, insertionRuns(entries, edit)));
    }
    changes.push({ changeId, delWId, insWId, deletedText, insertedText: edit.replace, contextBefore: edit.contextBefore || undefined, contextAfter: edit.contextAfter || undefined, reason: edit.reason });
    skipUntil = Math.max(skipUntil, edit.end);
    editIndex += 1;
  };

  for (const entry of entries) {
    const entryStart = entry.kind === "run" || entry.kind === "unsupportedText" ? entry.start : entry.position;
    if (entry.kind === "node" && entry.name === "w:pPr") {
      rebuilt.push(entry.node);
      continue;
    }
    while (editIndex < validEdits.length && validEdits[editIndex]!.start === entryStart && validEdits[editIndex]!.start === validEdits[editIndex]!.end) {
      appendEdit(validEdits[editIndex]!);
    }
    if (entry.kind !== "run") {
      rebuilt.push(entry.node);
      continue;
    }
    if (entry.end <= skipUntil) continue;
    if (entry.start >= skipUntil && !runEntryTouched(entry, validEdits)) {
      rebuilt.push(entry.node);
      continue;
    }
    let position = Math.max(entry.start, skipUntil);
    while (position < entry.end) {
      const nextEdit = validEdits[editIndex];
      if (nextEdit && nextEdit.start === position) {
        appendEdit(nextEdit);
        position = Math.max(position, skipUntil);
        continue;
      }
      const nextBoundary = nextEdit && nextEdit.start > position && nextEdit.start < entry.end ? nextEdit.start : entry.end;
      rebuilt.push(...formattedTextRun(entry.text.slice(position - entry.start, nextBoundary - entry.start), false, entry.runProperties));
      position = nextBoundary;
    }
  }
  while (editIndex < validEdits.length && validEdits[editIndex]!.start === text.length && validEdits[editIndex]!.start === validEdits[editIndex]!.end) {
    appendEdit(validEdits[editIndex]!);
  }
  const name = nodeName(paragraph);
  if (name && changes.length > 0) paragraph[name] = rebuilt;
  return { changes, errors };
}
