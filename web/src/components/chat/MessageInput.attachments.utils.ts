/**
 * Classify a MIME type into an attachment type string.
 *
 * Must match the classification used by iOS and Android so that the backend's
 * attachmentToParts() routes to the correct branch (e.g. "document" triggers
 * the tool-hint path with storageId, while "file" falls through to inline).
 */
export function attachmentTypeForMime(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  // Everything else (CSV, XLSX, DOCX, TXT, etc.) → "document"
  // so the backend can inject tool-use hints with storageId.
  return "document";
}
