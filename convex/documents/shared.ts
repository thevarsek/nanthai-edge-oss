import { Id } from "../_generated/dataModel";

export type CanonicalDocumentSource = "upload" | "generated" | "drive";
export type CanonicalDocumentVersionSource =
  | "upload"
  | "generated"
  | "drive_import"
  | "drive_refresh"
  | "user_upload"
  | "assistant_edit";

export interface ScopedDocument {
  ref: string;
  documentId: Id<"documents">;
  versionId?: Id<"documentVersions">;
  filename: string;
  title: string;
  mimeType: string;
  source: CanonicalDocumentSource;
  storageId: Id<"_storage">;
  versionNumber?: number;
  extractionStatus?: string;
  extractionTextStorageId?: Id<"_storage">;
  syncState?: string;
  /**
   * Google Drive file ID when this document originated from a Drive import.
   * Allows correlating `drive_*` tool results (which return Drive `fileId`)
   * with scoped document handles so the model can hand off from
   * `drive_read` (binary) to `read_document`/`find_in_document`.
   */
  driveFileId?: string;
}

export interface ParsedDocumentCitation {
  ref: number;
  docId: string;
  page?: number | string;
  locator?: string;
  quote: string;
}

export const CITATIONS_BLOCK_RE = /<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/;
export const CITATIONS_BLOCK_OR_PARTIAL_RE = /<CITATIONS>\s*[\s\S]*?<\/CITATIONS>|<CITATIONS>[\s\S]*$/g;

const READABLE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "application/csv",
  "application/json",
]);

export function isReadableDocumentMime(mimeType?: string, filename?: string): boolean {
  const normalizedMime = (mimeType ?? "").toLowerCase();
  if (normalizedMime.startsWith("text/")) return true;
  if (READABLE_MIME_TYPES.has(normalizedMime)) return true;
  const lowerName = (filename ?? "").toLowerCase();
  return (
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  );
}

export function versionSourceForDocumentSource(
  source: CanonicalDocumentSource,
): CanonicalDocumentVersionSource {
  if (source === "drive") return "drive_import";
  if (source === "generated") return "generated";
  return "upload";
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCitationMatchText(value: string): string {
  return normalizeWhitespace(value)
    .normalize("NFKC")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

function normalizeCitationMatchTextCompact(value: string): string {
  return normalizeCitationMatchText(value).replace(/\s+/g, "");
}

export function quoteExistsInText(quote: string, text: string): boolean {
  const normalizedQuote = normalizeCitationMatchText(quote);
  if (!normalizedQuote) return false;
  const normalizedText = normalizeCitationMatchText(text);
  if (normalizedText.includes(normalizedQuote)) return true;

  // PDF extraction can introduce spaces inside words (e.g. "n ot" or
  // "work s"). Keep exact-document validation, but tolerate those artifacts.
  return normalizeCitationMatchTextCompact(text).includes(
    normalizeCitationMatchTextCompact(quote),
  );
}

export function stripCitationBlock(value: string): string {
  return value.replace(CITATIONS_BLOCK_OR_PARTIAL_RE, "").trim();
}

function normalizeCitation(raw: unknown): ParsedDocumentCitation | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const ref = typeof entry.ref === "number" ? entry.ref : Number(entry.ref);
  const docId =
    typeof entry.doc_id === "string"
      ? entry.doc_id
      : typeof entry.documentId === "string"
        ? entry.documentId
        : "";
  const quote = typeof entry.quote === "string" ? entry.quote.trim() : "";
  if (!Number.isFinite(ref) || !docId || !quote) return null;

  const page =
    typeof entry.page === "number" || typeof entry.page === "string"
      ? entry.page
      : undefined;
  const locator = typeof entry.locator === "string" ? entry.locator : undefined;
  return { ref, docId, page, locator, quote };
}

export function parseDocumentCitations(value: string): ParsedDocumentCitation[] {
  const match = value.match(CITATIONS_BLOCK_RE);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeCitation)
      .filter((entry): entry is ParsedDocumentCitation => entry != null);
  } catch {
    return [];
  }
}

export function documentCitationPromptSuffix(scopedDocuments: ScopedDocument[]): string {
  if (scopedDocuments.length === 0) return "";
  const available = scopedDocuments
    .map((doc) => `- ${doc.ref}: ${doc.filename}${doc.versionNumber ? ` (V${doc.versionNumber})` : ""}`)
    .join("\n");

  return `
DOCUMENT CITATION INSTRUCTIONS:
The user has explicitly attached or selected these readable documents for this chat turn:
${available}

Use list_documents, read_document, or find_in_document when answering questions about document content. The doc-* labels are internal handles for tool calls and citation JSON only. Never write doc-* labels in user-facing prose; use the filename instead.

When you reference specific content from a scoped document, place a numbered marker [1], [2], etc. inline in your prose. After your complete response, append a <CITATIONS> block containing a JSON array with one entry per marker:

<CITATIONS>
[
  {"ref": 1, "doc_id": "doc-0", "page": 3, "quote": "exact verbatim text from the document"}
]
</CITATIONS>

Rules:
- Only cite text that appears verbatim in the scoped documents.
- Every [N] marker in prose must have a matching {"ref": N, ...} entry.
- "doc_id" must be the exact doc-* handle from the scoped document list.
- Keep quotes short and narrowly scoped to the claim.
- Omit the <CITATIONS> block when you make no claims about scoped document contents.
`.trim();
}
