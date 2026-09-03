// convex/tools/read_eml.ts
// =============================================================================
// Tool: read_eml — reads and parses an RFC 5322 email (.eml) file from
// Convex storage. Extracts headers, body (plain text and/or HTML), and
// provides a structured summary the model can reason about.
//
// No external dependencies — pure string parsing of the RFC 5322 format.
// =============================================================================

import { Id } from "../_generated/dataModel";
import { bytesToBinaryString, parseEml, stripHtml } from "./eml_parser";
import { createTool } from "./registry";

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

    // Keep the original octets intact until each MIME part's declared charset
    // is known. Blob.text() always decodes as UTF-8 and corrupts 8-bit mail.
    const rawText = bytesToBinaryString(new Uint8Array(await blob.arrayBuffer()));
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
