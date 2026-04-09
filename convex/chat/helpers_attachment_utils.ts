import { ContentPart } from "../lib/openrouter";
import { ContextAttachment, ContextMessage } from "./helpers_types";

export function splitMessageAttachmentParts(
  message: ContextMessage,
): { imageParts: ContentPart[]; nonImageParts: ContentPart[] } {
  const imageParts: ContentPart[] = [];
  const nonImageParts: ContentPart[] = [];

  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      const parts = attachmentToParts(attachment);
      for (const part of parts) {
        if (part.type === "image_url") {
          imageParts.push(part);
        } else {
          nonImageParts.push(part);
        }
      }
    }
  }

  if (message.imageUrls && message.imageUrls.length > 0) {
    for (const rawUrl of message.imageUrls) {
      const normalized = rawUrl.trim();
      if (!normalized) continue;
      imageParts.push({
        type: "image_url",
        image_url: { url: normalizeAttachmentPayload(normalized), detail: "auto" },
      });
    }
  }

  return { imageParts, nonImageParts };
}

export function attachmentTriggeredReadToolNames(
  attachments: ContextAttachment[] | undefined,
): string[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const toolNames = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.type !== "document" || !attachment.storageId) {
      continue;
    }

    const directReadTool = directAttachmentReadToolForMime(
      attachment.mimeType ?? "application/octet-stream",
      attachment.name ?? "document",
    );
    if (directReadTool) {
      toolNames.add(directReadTool);
    }
  }

  return Array.from(toolNames);
}

function directAttachmentReadToolForMime(
  mime: string,
  filename: string,
): string | null {
  const m = mime.toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return "read_docx";
  }
  if (
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  ) {
    return "read_xlsx";
  }
  if (
    m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  ) {
    return "read_pptx";
  }
  if (
    m === "text/csv" ||
    m === "application/csv" ||
    m === "text/markdown" ||
    m === "text/x-markdown" ||
    m === "text/plain" ||
    ext === "csv" ||
    ext === "md" ||
    ext === "txt"
  ) {
    return "read_text_file";
  }
  if (m === "message/rfc822" || ext === "eml") {
    return "read_eml";
  }

  return null;
}

export function resolveAllowedImageMessageIds(
  messages: ContextMessage[],
): Set<string> {
  const allowed = new Set<string>();
  const seenKeys = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const { imageParts } = splitMessageAttachmentParts(message);
    if (imageParts.length === 0) continue;

    const key = participantKeyForImages(message);
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    allowed.add(message._id);
  }

  return allowed;
}

function normalizeAttachmentPayload(
  rawPayload: string,
  mimeType?: string,
): string {
  if (rawPayload.startsWith("data:") || /^https?:\/\//i.test(rawPayload)) {
    return rawPayload;
  }
  return `data:${mimeType ?? "application/octet-stream"};base64,${rawPayload}`;
}

function attachmentToParts(
  attachment: ContextAttachment,
): ContentPart[] {
  const rawUrl = attachment.url?.trim();

  if (attachment.type === "image") {
    const parts: ContentPart[] = [];

    // Visual part — lets the model "see" the image.
    if (rawUrl) {
      const normalizedPayload = normalizeAttachmentPayload(rawUrl, attachment.mimeType);
      parts.push({
        type: "image_url",
        image_url: { url: normalizedPayload, detail: "auto" },
      });
    }

    // Text reference — gives the model a programmatic handle for tool calls.
    // Without this, the model can see the image but can't pass it to
    // generate_pptx / edit_pptx / fetch_image.
    if (attachment.storageId) {
      const filename = attachment.name ?? "image";
      const mime = attachment.mimeType ?? "image/png";
      parts.push({
        type: "text",
        text:
          `[Attached image: "${filename}" (${mime}), storageId: ${attachment.storageId}]\n` +
          `To use this image in a presentation, pass imageStorageId "${attachment.storageId}" ` +
          `directly in generate_pptx or edit_pptx slide images — no need to call fetch_image first.`,
      });
    }

    return parts;
  }

  // For document types with a storageId, inject a MIME-aware text description
  // so the model uses the correct read/edit tool.
  if (attachment.type === "document" && attachment.storageId) {
    const filename = attachment.name ?? "document";
    const mime = attachment.mimeType ?? "application/octet-stream";
    const toolInfo = documentToolsForMime(mime, filename);
    const workflowHint = toolInfo.editTool
      ? ` For formatting-aware edits or regeneration, load the matching document skill before using ${toolInfo.editTool}.`
      : ` For deeper document workflows, load the documents skill before generating a rewritten output.`;
    // For data files (CSV, TSV, XLSX), add a strong directive to use
    // workspace_import_file for analysis instead of reading content inline,
    // which gets truncated for large files.
    const dataAnalysisHint = toolInfo.isDataFile
      ? `\nIMPORTANT: For data analysis, do NOT parse this file's contents from inline conversation text — it will be truncated for large files. ` +
        `Pass the storageId in the inputFiles parameter of data_python_exec or data_python_sandbox ` +
        `— the file will be available at /tmp/inputs/${filename}. ` +
        `For workspace shell tools (workspace_exec), use workspace_import_file with storageId "${attachment.storageId}" to import the file first.`
      : ``;
    return [{
      type: "text",
      text:
        `[Attached file: "${filename}" (${mime}), storageId: ${attachment.storageId}]\n` +
        `To read this file's contents, use the ${toolInfo.readTool} tool with storageId "${attachment.storageId}".` +
        workflowHint +
        dataAnalysisHint,
    }];
  }

  // Audio attachments are only sent as `input_audio` on the current user turn.
  // Historical turns replay transcript text only.
  if (attachment.type === "audio") {
    return [];
  }

  // All other non-image files (PDF, audio, video) — send inline.
  if (!rawUrl) return [];
  const normalizedPayload = normalizeAttachmentPayload(rawUrl, attachment.mimeType);
  return [{
    type: "file",
    file: {
      filename: attachment.name ?? "attachment",
      file_data: normalizedPayload,
    },
  }];
}

function participantKeyForImages(message: ContextMessage): string {
  if (message.participantId) {
    return `persona:${message.participantId}`;
  }
  if (message.autonomousParticipantId?.trim()) {
    return `autonomous:${message.autonomousParticipantId.trim()}`;
  }
  if (message.modelId?.trim()) {
    return `model:${message.modelId.trim()}`;
  }
  if (message.participantName?.trim()) {
    return `name:${message.participantName.trim()}`;
  }
  return "default";
}

/**
 * Map a document MIME type (or filename extension) to the correct read/edit tool names.
 * For text-based formats (csv/txt/md/eml), editTool is null — the model reads
 * the original and generates a new file instead of in-place editing.
 * Falls back to docx tools for unrecognised types.
 */
function documentToolsForMime(
  mime: string,
  filename: string,
): { readTool: string; editTool: string | null; isDataFile?: boolean } {
  const m = mime.toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  // OOXML formats — have read + edit tools
  if (
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  ) {
    return { readTool: "read_xlsx", editTool: "edit_xlsx", isDataFile: true };
  }
  if (
    m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  ) {
    return { readTool: "read_pptx", editTool: "edit_pptx" };
  }

  // Data-oriented text formats — read only, flag for analysis workflow hint
  if (m === "text/csv" || m === "application/csv" || ext === "csv") {
    return { readTool: "read_text_file", editTool: null, isDataFile: true };
  }
  if (m === "text/tab-separated-values" || ext === "tsv") {
    return { readTool: "read_text_file", editTool: null, isDataFile: true };
  }
  if (m === "text/markdown" || m === "text/x-markdown" || ext === "md") {
    return { readTool: "read_text_file", editTool: null };
  }
  if (m === "text/plain" || ext === "txt") {
    return { readTool: "read_text_file", editTool: null };
  }

  // Email format
  if (m === "message/rfc822" || ext === "eml") {
    return { readTool: "read_eml", editTool: null };
  }

  // Default to docx tools (covers .docx and any unknown document type)
  return { readTool: "read_docx", editTool: "edit_docx" };
}
