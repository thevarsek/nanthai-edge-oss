// convex/tools/sanitize.ts
// =============================================================================
// Shared filename sanitization for tool-generated files.
// =============================================================================

/**
 * Sanitize a title for use as a filename. Replaces unsafe character runs with
 * a single underscore and trims leading/trailing separators.
 *
 * @param title   - Raw title from model output.
 * @param fallback - Fallback name if sanitized result is empty (default: "file").
 */
export function sanitizeFilename(title: string, fallback = "file"): string {
  return title
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    || fallback;
}
