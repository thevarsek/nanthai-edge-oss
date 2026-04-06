// convex/tools/edit_xlsx.ts
// =============================================================================
// Tool: edit_xlsx — reads an existing .xlsx from Convex storage, then generates
// a new version with updated sheet data. Uses the read→regenerate pattern
// (same as edit_docx and edit_pptx).
//
// Supports the same extended params as generate_xlsx: cell styles, number formats,
// merged cells, named ranges, explicit column widths.
//
// Uses JSZip-based reader + writer — works in Convex's default V8 runtime.
// =============================================================================

import { Id } from "../_generated/dataModel";
import { extractXlsx } from "./xlsx_reader";
import { buildXlsxBlob, XlsxSheet, XlsxCellStyle, XlsxColumnFormat } from "./xlsx_writer";
import { createTool } from "./registry";
import { sanitizeFilename } from "./sanitize";

export const editXlsx = createTool({
  name: "edit_xlsx",
  description:
    "Edit a Microsoft Excel spreadsheet (.xlsx). Reads the original from storage " +
    "for verification, then generates a new version with the provided updated sheets. " +
    "Use when the user wants to modify, add rows/columns, recalculate, or restructure " +
    "an existing Excel file. You must provide the full updated sheet list — this replaces " +
    "the entire spreadsheet. First use read_xlsx to understand the current content, then " +
    "provide the complete updated sheets here. Supports the same formatting options as " +
    "generate_xlsx (cell styles, number formats, merged cells, named ranges).",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "The Convex storage ID of the original .xlsx file to edit",
      },
      title: {
        type: "string",
        description: "Spreadsheet title for the updated version (used for filename)",
      },
      sheets: {
        type: "array",
        description:
          "The full updated sheet list (replaces all sheets). Each sheet " +
          "has a name, headers, and data rows.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Worksheet tab name (max 31 chars)" },
            headers: {
              type: "array",
              description: "Column headers for the first row.",
              items: { type: "string" },
            },
            rows: {
              type: "array",
              description: "Data rows. Each row is an array of cell values (numbers, strings, booleans, null, or '=FORMULA').",
              items: { type: "array", items: {} },
            },
            columnWidths: {
              type: "array",
              description: "Explicit column widths. Auto-sized if omitted.",
              items: { type: "number" },
            },
            cellStyles: {
              type: "array",
              description: "Cell style overrides (same as generate_xlsx).",
              items: {
                type: "object",
                properties: {
                  range: { type: "string", description: "Cell range in A1 notation." },
                  bold: { type: "boolean" },
                  fontColor: { type: "string", description: "Hex RGB without #." },
                  bgColor: { type: "string", description: "Hex RGB without #." },
                  borderStyle: { type: "string", description: "'thin', 'medium', or 'thick'." },
                  numberFormat: { type: "string", description: "Number format string." },
                },
                required: ["range"],
              },
            },
            columnFormats: {
              type: "array",
              description: "Number format per column (same as generate_xlsx).",
              items: {
                type: "object",
                properties: {
                  column: { type: "number", description: "Column index (0-based)." },
                  format: { type: "string", description: "Excel number format string." },
                },
                required: ["column", "format"],
              },
            },
            mergedCells: {
              type: "array",
              description: "Merged cell ranges in A1 notation.",
              items: { type: "string" },
            },
          },
          required: ["name", "headers", "rows"],
        },
      },
      namedRanges: {
        type: "array",
        description: "Named ranges for the workbook.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            range: { type: "string" },
          },
          required: ["name", "range"],
        },
      },
    },
    required: ["storageId", "title", "sheets"],
  },

  execute: async (toolCtx, args) => {
    if (!args.storageId || typeof args.storageId !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'storageId'" };
    }
    const { storageId, title, sheets: rawSheets, namedRanges } = args as {
      storageId: string;
      title: string;
      sheets: Array<{
        name: string;
        headers: string[];
        rows: unknown[][];
        columnWidths?: number[];
        cellStyles?: XlsxCellStyle[];
        columnFormats?: XlsxColumnFormat[];
        mergedCells?: string[];
      }>;
      namedRanges?: Array<{ name: string; range: string }>;
    };

    if (!title || typeof title !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'title'" };
    }

    // Read the original to verify it exists and is a valid .xlsx
    let originalBlob: Blob | null;
    try {
      originalBlob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return { success: false, data: null, error: `Invalid storageId: "${storageId}"` };
    }
    if (!originalBlob) {
      return { success: false, data: null, error: `File not found for storageId: "${storageId}"` };
    }

    // Verify it's parseable
    try {
      const arrayBuffer = await originalBlob.arrayBuffer();
      await extractXlsx(arrayBuffer);
    } catch (e) {
      return {
        success: false, data: null,
        error: `Original file is not a valid .xlsx: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (!rawSheets || rawSheets.length === 0) {
      return { success: false, data: null, error: "At least one sheet is required." };
    }

    // Sanitize and coerce
    const sheets: XlsxSheet[] = rawSheets.map((s, i) => {
      const safeName = (s.name || `Sheet${i + 1}`)
        .replace(/[/\\?*[\]]/g, "_")
        .slice(0, 31);

      const rows = s.rows.map((row) =>
        row.map((cell) => {
          if (cell == null) return null;
          if (typeof cell === "number") return cell;
          if (typeof cell === "boolean") return cell;
          const str = String(cell);
          if (/^-?\d+(\.\d+)?$/.test(str.trim())) {
            const num = Number(str.trim());
            if (isFinite(num)) return num;
          }
          return str;
        }),
      );

      return {
        name: safeName,
        headers: s.headers || [],
        rows,
        columnWidths: s.columnWidths,
        cellStyles: s.cellStyles,
        columnFormats: s.columnFormats,
        mergedCells: s.mergedCells,
      };
    });

    // Generate new .xlsx
    const blob = await buildXlsxBlob({ title, sheets, namedRanges });

    // Store in Convex file storage
    const newStorageId = await toolCtx.ctx.storage.store(blob);

    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    const sheetSummary = sheets
      .map((s) => `"${s.name}" (${s.headers.length} cols, ${s.rows.length} rows)`)
      .join(", ");

    const safeTitle = sanitizeFilename(title, "spreadsheet");
    const filename = `${safeTitle}.xlsx`;
    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(newStorageId)}&filename=${encodeURIComponent(filename)}`
      : await toolCtx.ctx.storage.getUrl(newStorageId);

    return {
      success: true,
      data: {
        storageId: newStorageId,
        originalStorageId: storageId,
        downloadUrl,
        filename,
        sheets: sheetSummary,
        totalRows,
        markdownLink: `[${filename}](${downloadUrl})`,
        message:
          `Spreadsheet updated. Present the download link to the user using markdown: [${filename}](${downloadUrl})`,
      },
    };
  },
});
