// convex/tools/sanitize.ts
// =============================================================================
// Shared filename sanitization for tool-generated files.
// =============================================================================

/**
 * Sanitize a title for use as a filename. Strips non-alphanumeric characters
 * (except spaces, underscores, and hyphens) and trims whitespace.
 *
 * @param title   - Raw title from model output.
 * @param fallback - Fallback name if sanitized result is empty (default: "file").
 */
export function sanitizeFilename(title: string, fallback = "file"): string {
  return title.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || fallback;
}
