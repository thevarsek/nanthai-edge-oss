"use node";

import type { XmlNode } from "./docx_tracked_changes_xml";

export type ProposedDocxEdit = {
  find: string;
  replace: string;
  contextBefore: string;
  contextAfter: string;
  reason?: string;
};

export type AppliedDocxChange = {
  changeId: string;
  delWId?: string;
  insWId?: string;
  deletedText: string;
  insertedText: string;
  contextBefore?: string;
  contextAfter?: string;
  reason?: string;
};

export type DocxEditError = {
  index: number;
  code:
    | "EMPTY_EDIT"
    | "PURE_INSERT_REQUIRES_CONTEXT"
    | "MATCH_NOT_FOUND"
    | "MATCH_AMBIGUOUS"
    | "OVERLAPPING_EDIT"
    | "UNSUPPORTED_DOCX"
    | "INVALID_XML";
  message: string;
};

export type ParagraphEdit = ProposedDocxEdit & { index: number; start: number; end: number };

export type ParagraphEntry =
  | { kind: "node"; node: XmlNode; position: number; name: string | null }
  | { kind: "run"; node: XmlNode; start: number; end: number; text: string; runProperties?: XmlNode }
  | { kind: "unsupportedText"; node: XmlNode; start: number; end: number; text: string; name: string | null };
