// convex/tools/read_eml.ts
// =============================================================================
// Tool: read_eml — reads and parses an RFC 5322 email (.eml) file from
// Convex storage. Extracts headers, body (plain text and/or HTML), and
// provides a structured summary the model can reason about.
//
// No external dependencies — pure string parsing of the RFC 5322 format.
// =============================================================================

import { Id } from "../_generated/dataModel";
import { createTool } from "./registry";

// ---------------------------------------------------------------------------
// EML parser
// ---------------------------------------------------------------------------

interface ParsedEmail {
  headers: Record<string, string>;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  bodyText?: string;
  bodyHtml?: string;
  rawBody: string;
}

/**
 * Parse an RFC 5322 email. Handles:
 * - Unfolded multi-line headers (continuation lines start with whitespace)
 * - multipart/alternative boundaries (text + HTML)
 * - Plain text single-part messages
 */
function parseEml(raw: string): ParsedEmail {
  // Normalize line endings to \n
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split headers from body at the first blank line
  const headerBodySplit = text.indexOf("\n\n");
  const headerSection = headerBodySplit >= 0 ? text.substring(0, headerBodySplit) : text;
  const rawBody = headerBodySplit >= 0 ? text.substring(headerBodySplit + 2) : "";

  // Unfold continuation lines (lines starting with space/tab are continuations)
  const unfoldedHeaders = headerSection.replace(/\n[ \t]+/g, " ");

  // Parse headers
  const headers: Record<string, string> = {};
  for (const line of unfoldedHeaders.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();
    // If duplicate header, append with comma
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }

  const result: ParsedEmail = {
    headers,
    from: headers["from"],
    to: headers["to"],
    cc: headers["cc"],
    subject: headers["subject"],
    date: headers["date"],
    rawBody,
  };

  // Detect multipart
  const contentType = headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary="?([^";\n]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const parts = splitMultipart(rawBody, boundary);

    for (const part of parts) {
      const partContentType = extractPartHeader(part, "content-type") || "";
      const partBody = extractPartBody(part);

      if (partContentType.includes("text/plain")) {
        result.bodyText = decodePartBody(partBody, part);
      } else if (partContentType.includes("text/html")) {
        result.bodyHtml = decodePartBody(partBody, part);
      }
    }
  } else if (contentType.includes("text/html")) {
    result.bodyHtml = decodePartBody(rawBody, headerSection);
  } else {
    // Default: treat as plain text
    result.bodyText = rawBody;
  }

  return result;
}

/** Split multipart body by boundary. Returns individual MIME parts. */
function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const delim = `--${boundary}`;
  const endDelim = `--${boundary}--`;
  const segments = body.split(delim);

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i].trim();
    if (segment.startsWith("--") || segment === "") continue; // End boundary or empty
    if (segment === endDelim.substring(delim.length)) continue;
    parts.push(segment);
  }

  return parts;
}

/** Extract a header from a MIME part (before the blank line). */
function extractPartHeader(part: string, headerName: string): string | undefined {
  const blankLine = part.indexOf("\n\n");
  const headerSection = blankLine >= 0 ? part.substring(0, blankLine) : part;
  const unfolded = headerSection.replace(/\n[ \t]+/g, " ");

  for (const line of unfolded.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.substring(0, colonIdx).trim().toLowerCase();
    if (key === headerName.toLowerCase()) {
      return line.substring(colonIdx + 1).trim();
    }
  }
  return undefined;
}

/** Extract the body (after headers) of a MIME part. */
function extractPartBody(part: string): string {
  const blankLine = part.indexOf("\n\n");
  return blankLine >= 0 ? part.substring(blankLine + 2) : "";
}

/** Decode part body — handle quoted-printable encoding. */
function decodePartBody(body: string, headers: string): string {
  const lowerHeaders = headers.toLowerCase();
  if (lowerHeaders.includes("quoted-printable")) {
    return decodeQuotedPrintable(body);
  }
  // Base64 encoded text parts
  if (lowerHeaders.includes("base64")) {
    try {
      // Decode via binary string → Uint8Array → TextDecoder for proper UTF-8
      const raw = atob(body.replace(/\s/g, ""));
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return body; // If decode fails, return raw
    }
  }
  return body;
}

/** Decode quoted-printable encoding. */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\n/g, "") // Soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

/** Strip HTML tags for a plain-text fallback. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const readEml = createTool({
  name: "read_eml",
  description:
    "Read and parse an email file (.eml) from Convex storage. Extracts " +
    "headers (From, To, Cc, Subject, Date) and body content (plain text " +
    "and/or HTML). Use when the user uploads a .eml file and wants to " +
    "view, summarize, or analyze its contents.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "Convex storage ID of the .eml file to read.",
      },
    },
    required: ["storageId"],
  },

  execute: async (toolCtx, args) => {
    const storageId = args.storageId as string;

    if (!storageId || typeof storageId !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'storageId'" };
    }

    let blob: Blob | null;
    try {
      blob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return { success: false, data: null, error: `Invalid storageId: ${storageId}` };
    }
    if (!blob) {
      return { success: false, data: null, error: `File not found for storageId: ${storageId}` };
    }

    const rawText = await blob.text();
    if (!rawText.trim()) {
      return {
        success: true,
        data: { message: "The .eml file is empty." },
      };
    }

    const parsed = parseEml(rawText);

    // Build a readable body — prefer plain text, fall back to stripped HTML
    let body = parsed.bodyText?.trim() || "";
    if (!body && parsed.bodyHtml) {
      body = stripHtml(parsed.bodyHtml);
    }

    const result: Record<string, unknown> = {
      from: parsed.from || "(unknown)",
      to: parsed.to || "(unknown)",
      subject: parsed.subject || "(no subject)",
      date: parsed.date || "(no date)",
      body,
      headerCount: Object.keys(parsed.headers).length,
    };

    if (parsed.cc) {
      result.cc = parsed.cc;
    }

    if (parsed.bodyHtml) {
      result.hasHtmlBody = true;
    }

    // Truncation guard
    if (body.length > 50000) {
      result.warning =
        `Email body is large (${body.length} chars). Consider summarizing.`;
    }

    return { success: true, data: result };
  },
});
