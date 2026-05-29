"use node";

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

export type XmlNode = Record<string, unknown>;
export type XmlArray = XmlNode[];

export const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

export const builder = new XMLBuilder({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "",
  textNodeName: "#text",
  suppressEmptyNode: false,
  format: false,
});

export function nodeName(node: XmlNode): string | null {
  return Object.keys(node).find((key) => key !== ":@") ?? null;
}

export function children(node: XmlNode): XmlArray | null {
  const name = nodeName(node);
  if (!name) return null;
  const value = node[name];
  return Array.isArray(value) ? value as XmlArray : null;
}

export function attrs(node: XmlNode): Record<string, string> {
  const raw = node[":@"] as Record<string, string> | undefined;
  return raw ?? {};
}

export function setAttrs(node: XmlNode, value: Record<string, string>): void {
  node[":@"] = value;
}

export function readTextNodes(nodes: XmlArray, visible: boolean, parts: string[]): void {
  for (const node of nodes) {
    const name = nodeName(node);
    if (!name) continue;
    if (name === "w:del") {
      readTextNodes(children(node) ?? [], false, parts);
    } else if (visible && name === "w:br") {
      parts.push("\n");
    } else if (visible && name === "w:tab") {
      parts.push("\t");
    } else if (visible && (name === "w:t" || name === "w:delText")) {
      const textNode = (children(node) ?? []).find((child) => Object.hasOwn(child, "#text"));
      parts.push(String(textNode?.["#text"] ?? ""));
    } else {
      readTextNodes(children(node) ?? [], visible, parts);
    }
  }
}

export function paragraphText(paragraph: XmlNode): string {
  const parts: string[] = [];
  readTextNodes(children(paragraph) ?? [], true, parts);
  return parts.join("");
}

export function paragraphStyle(paragraph: XmlNode): string {
  const paragraphProperties = (children(paragraph) ?? []).find((child) => nodeName(child) === "w:pPr");
  const style = (children(paragraphProperties ?? {}) ?? []).find((child) => nodeName(child) === "w:pStyle");
  return attrs(style ?? {})["w:val"] ?? "Normal";
}

export function collectParagraphs(nodes: XmlArray, out: XmlNode[]): void {
  for (const node of nodes) {
    const name = nodeName(node);
    if (name === "w:p") out.push(node);
    const inner = children(node);
    if (inner) collectParagraphs(inner, out);
  }
}

export async function extractAcceptedParagraphs(
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ paragraphs: { style: string; text: string }[]; text: string; wordCount: number }> {
  const { tree } = await loadDocumentXml(bytes);
  const paragraphNodes: XmlNode[] = [];
  collectParagraphs(tree, paragraphNodes);
  const paragraphs = paragraphNodes
    .map((paragraph) => ({ style: paragraphStyle(paragraph), text: paragraphText(paragraph) }))
    .filter((paragraph) => paragraph.text.trim().length > 0);
  const text = paragraphs.map((paragraph) => paragraph.text).join("\n");
  return { paragraphs, text, wordCount: text.split(/\s+/).filter(Boolean).length };
}

export type ReviewTextSegment = {
  kind: "normal" | "inserted" | "deleted";
  text: string;
};

function pushReviewSegment(out: ReviewTextSegment[], kind: ReviewTextSegment["kind"], text: string): void {
  if (!text) return;
  const previous = out[out.length - 1];
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  out.push({ kind, text });
}

function readReviewTextNodes(
  nodes: XmlArray,
  kind: ReviewTextSegment["kind"],
  parts: ReviewTextSegment[],
): void {
  for (const node of nodes) {
    const name = nodeName(node);
    if (!name) continue;
    if (name === "w:del") {
      readReviewTextNodes(children(node) ?? [], "deleted", parts);
    } else if (name === "w:ins") {
      readReviewTextNodes(children(node) ?? [], "inserted", parts);
    } else if (name === "w:br") {
      pushReviewSegment(parts, kind, "\n");
    } else if (name === "w:tab") {
      pushReviewSegment(parts, kind, "\t");
    } else if (name === "w:t" || name === "w:delText") {
      const textNode = (children(node) ?? []).find((child) => Object.hasOwn(child, "#text"));
      pushReviewSegment(parts, kind, String(textNode?.["#text"] ?? ""));
    } else {
      readReviewTextNodes(children(node) ?? [], kind, parts);
    }
  }
}

export async function extractReviewParagraphs(
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ paragraphs: { style: string; segments: ReviewTextSegment[] }[]; text: string; wordCount: number }> {
  const { tree } = await loadDocumentXml(bytes);
  const paragraphNodes: XmlNode[] = [];
  collectParagraphs(tree, paragraphNodes);
  const paragraphs = paragraphNodes
    .map((paragraph) => {
      const segments: ReviewTextSegment[] = [];
      readReviewTextNodes(children(paragraph) ?? [], "normal", segments);
      return { style: paragraphStyle(paragraph), segments };
    })
    .filter((paragraph) => paragraph.segments.some((segment) => segment.text.trim().length > 0));
  const text = paragraphs
    .map((paragraph) => paragraph.segments.map((segment) => segment.text).join(""))
    .join("\n");
  return { paragraphs, text, wordCount: text.split(/\s+/).filter(Boolean).length };
}

export function textRun(text: string, deleted: boolean): XmlNode[] {
  const pieces = text.split("\n");
  const runChildren: XmlArray = [];
  pieces.forEach((piece, index) => {
    if (index > 0) runChildren.push({ "w:br": [] });
    const tag = deleted ? "w:delText" : "w:t";
    runChildren.push({ [tag]: [{ "#text": piece }], ":@": { "xml:space": "preserve" } });
  });
  return [{ "w:r": runChildren }];
}

export async function loadDocumentXml(bytes: ArrayBuffer | Uint8Array): Promise<{ zip: JSZip; path: string; tree: XmlArray }> {
  const zip = await JSZip.loadAsync(bytes);
  const path = zip.file("word/document.xml") ? "word/document.xml" : zip.file("word\\document.xml") ? "word\\document.xml" : "";
  if (!path) throw new Error("UNSUPPORTED_DOCX: missing word/document.xml");
  const xml = await zip.file(path)!.async("string");
  try {
    const tree = parser.parse(xml) as XmlArray;
    const root = tree.find((node) => nodeName(node) === "w:document");
    if (root) setAttrs(root, { ...attrs(root), "xmlns:nanthai": "https://nanthai.ai/ooxml/tracked-changes" });
    return { zip, path, tree };
  } catch (error) {
    throw new Error(`INVALID_XML: ${error instanceof Error ? error.message : String(error)}`);
  }
}
