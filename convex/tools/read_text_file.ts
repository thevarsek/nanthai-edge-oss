// convex/tools/read_text_file.ts
// =============================================================================
// Tool: read_text_file — reads a plain-text file (.csv, .txt, .md, or any
// UTF-8 text) from Convex storage and returns its contents.
//
// For CSV files, also provides a structured preview (parsed rows/columns)
// so the model can reason about tabular data without custom parsing.
// =============================================================================

import { Id } from "../_generated/dataModel";
import { createTool } from "./registry";

/** Parse CSV text into rows of string arrays. Handles quoted fields with commas/newlines. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // Handle \r\n or bare \r
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (i + 1 < text.length && text[i + 1] === "\n") i++;
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Final field/row
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export const readTextFile = createTool({
  name: "read_text_file",
  description:
    "Read a plain-text file (.csv, .txt, .md, or any UTF-8 text file) from " +
    "Convex storage. Returns the raw text content. For CSV files, also " +
    "provides a structured preview with parsed headers and sample rows.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "Convex storage ID of the file to read.",
      },
    },
    required: ["storageId"],
  },

  execute: async (toolCtx, args) => {
    if (!args.storageId || typeof args.storageId !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'storageId'" };
    }
    const storageId = args.storageId as string;

    let blob: Blob | null;
    try {
      blob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return { success: false, data: null, error: `Invalid storageId: ${storageId}` };
    }
    if (!blob) {
      return { success: false, data: null, error: `File not found for storageId: ${storageId}` };
    }

    const text = await blob.text();

    if (!text.trim()) {
      return {
        success: true,
        data: {
          content: "",
          charCount: 0,
          lineCount: 0,
          message: "The file is empty.",
        },
      };
    }

    const lines = text.split(/\r?\n/);

    // Detect CSV by MIME type or content heuristics (comma-separated with consistent column count)
    const mimeType = blob.type || "";
    const isCSV =
      mimeType === "text/csv" ||
      mimeType === "application/csv" ||
      (lines.length >= 2 && lines[0].includes(",") && !lines[0].startsWith("#"));

    const result: Record<string, unknown> = {
      content: text,
      charCount: text.length,
      lineCount: lines.length,
    };

    // For CSV, add structured preview
    if (isCSV) {
      const rows = parseCSV(text);
      if (rows.length >= 1) {
        const headers = rows[0];
        const dataRows = rows.slice(1);
        result.csvPreview = {
          headers,
          totalRows: dataRows.length,
          sampleRows: dataRows.slice(0, 20), // First 20 data rows
          columnCount: headers.length,
        };
      }
    }

    // Large file advisory: inform the model the file is large so it can summarize
    if (text.length > 50000) {
      result.warning =
        `File content is large (${text.length} chars, ${lines.length} lines). ` +
        `Consider summarizing or focusing on the most relevant sections.`;
    }

    return { success: true, data: result };
  },
});
