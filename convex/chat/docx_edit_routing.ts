import type { ToolDefinition } from "../lib/openrouter_types";

const EXPLICIT_FULL_DOCX_REPLACEMENT_PATTERNS = [
  /\b(?:rewrite|redraft|regenerate|recreate)\s+(?:this|the|my|our|attached)?\s*(?:document|docx|file|draft|contract|report|letter)\b/i,
  /\b(?:replace|rewrite|redraft|regenerate|recreate|rebuild)\b.{0,48}\b(?:entire|whole|full|complete)\s+(?:document|docx|file|draft|contract|report|letter)\b/i,
  /\b(?:entire|whole|full|complete)\s+(?:document|docx|file|draft|contract|report|letter)\b.{0,48}\b(?:replace|rewrite|redraft|regenerate|recreate|rebuild)\b/i,
  /\b(?:start|rebuild|recreate)\s+(?:it|the document|the docx|the file)?\s*(?:again\s+)?from scratch\b/i,
];

const DOCUMENT_CONTEXT_TOOL_NAMES = new Set([
  "list_documents",
  "read_document",
  "find_in_document",
  "read_docx",
  "propose_docx_edits",
  "edit_docx",
]);

export const FULL_DOCX_REPLACEMENT_BLOCKED_MESSAGE =
  "This request is a localized DOCX edit. Use read_document or " +
  "find_in_document, then propose_docx_edits so the user receives " +
  "reviewable Accept/Reject tracked changes. edit_docx is reserved for an " +
  "explicit whole-document rewrite or replacement.";

export function isExplicitFullDocxReplacementRequest(prompt: string): boolean {
  return EXPLICIT_FULL_DOCX_REPLACEMENT_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function filterDocxReplacementToolDefinitions(
  definitions: ToolDefinition[],
  userPrompt: string,
): ToolDefinition[] {
  if (isExplicitFullDocxReplacementRequest(userPrompt)) return definitions;
  return definitions.filter((definition) =>
    definition.type !== "function" || definition.function.name !== "edit_docx"
  );
}

export function shouldGroundDocumentRelativeDate(
  userPrompt: string,
  directToolNames: string[],
): boolean {
  return /\b(?:today|tomorrow|yesterday|this week|last week|next week)\b/i.test(userPrompt) &&
    directToolNames.some((toolName) => DOCUMENT_CONTEXT_TOOL_NAMES.has(toolName));
}
