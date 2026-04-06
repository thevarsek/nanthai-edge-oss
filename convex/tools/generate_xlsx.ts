// convex/tools/generate_xlsx.ts
// =============================================================================
// Tool: generate_xlsx — creates an Excel spreadsheet and stores it in Convex
// file storage. Returns a download URL the model can present to the user.
//
// Uses a custom JSZip-based OOXML writer (xlsx_writer.ts) so it works in
// Convex's default V8 runtime without "use node".
//
// Extended capabilities:
// - Cell-level styling (bold, font color, background color, borders)
// - Number formats per column or per cell range
// - Merged cells
// - Named ranges
// - Explicit column widths
// =============================================================================

import { createTool } from "./registry";
import { buildXlsxBlob, XlsxSheet, XlsxCellStyle, XlsxColumnFormat } from "./xlsx_writer";
import { sanitizeFilename } from "./sanitize";

export const generateXlsx = createTool({
  name: "generate_xlsx",
  description:
    "Generate a Microsoft Excel spreadsheet (.xlsx) with one or more worksheets. " +
    "Use for data tables, reports, budgets, trackers, calculations, or any tabular " +
    "content the user wants as a downloadable Excel file. Each sheet has a name, " +
    "headers, and data rows. Cells can contain text, numbers, booleans, or formulas " +
    "(prefix with '='). Numbers are stored as numeric values for proper sorting and " +
    "calculation in Excel. Supports cell styling, number formats, merged cells, " +
    "named ranges, and explicit column widths. All formatting params are optional " +
    "with sensible defaults.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Spreadsheet title (used for the filename, e.g. 'Q1 Budget')",
      },
      sheets: {
        type: "array",
        description: "One or more worksheets to include.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Worksheet tab name (max 31 chars, no special chars: / \\ ? * [ ])",
            },
            headers: {
              type: "array",
              description: "Column headers for the first row (bold, styled).",
              items: { type: "string" },
            },
            rows: {
              type: "array",
              description:
                "Data rows. Each row is an array of cell values. " +
                "Use numbers for numeric data, strings for text, " +
                "booleans for true/false, null for empty cells, " +
                "or strings starting with '=' for formulas (e.g. '=SUM(A2:A10)').",
              items: {
                type: "array",
                items: {},
              },
            },
            // ---- Optional per-sheet formatting ----
            columnWidths: {
              type: "array",
              description:
                "Explicit column widths (character units). Must match headers length. " +
                "Auto-sized from content if omitted.",
              items: { type: "number" },
            },
            cellStyles: {
              type: "array",
              description:
                "Cell style overrides. Each applies to a range (e.g. 'B2:B10', 'A1:C1', 'D5'). " +
                "Use for bold, colors, borders, or number formats on specific cells.",
              items: {
                type: "object",
                properties: {
                  range: {
                    type: "string",
                    description: "Cell range in A1 notation, e.g. 'A2:A100' or 'B5'.",
                  },
                  bold: { type: "boolean", description: "Bold text (default false)" },
                  fontColor: {
                    type: "string",
                    description: "Font color as hex RGB without #, e.g. 'FF0000' for red.",
                  },
                  bgColor: {
                    type: "string",
                    description: "Background fill color as hex RGB, e.g. 'FFFF00' for yellow.",
                  },
                  borderStyle: {
                    type: "string",
                    description: "Border style: 'thin', 'medium', or 'thick'.",
                  },
                  numberFormat: {
                    type: "string",
                    description:
                      "Number format string, e.g. '$#,##0.00' for currency, '0.0%' for percent, " +
                      "'yyyy-mm-dd' for dates, '#,##0' for thousands.",
                  },
                },
                required: ["range"],
              },
            },
            columnFormats: {
              type: "array",
              description:
                "Number format per column (applies to all data rows in that column). " +
                "Lower priority than cellStyles — cellStyles override these.",
              items: {
                type: "object",
                properties: {
                  column: {
                    type: "number",
                    description: "Column index (0-based). 0 = A, 1 = B, etc.",
                  },
                  format: {
                    type: "string",
                    description:
                      "Excel number format string. Common: '$#,##0.00', '0.0%', 'yyyy-mm-dd', '#,##0'.",
                  },
                },
                required: ["column", "format"],
              },
            },
            mergedCells: {
              type: "array",
              description:
                "Merged cell ranges in A1 notation, e.g. ['A1:C1', 'D5:D10']. " +
                "Use sparingly — merged cells break sorting/filtering.",
              items: { type: "string" },
            },
          },
          required: ["name", "headers", "rows"],
        },
      },
      // ---- Optional workbook-level params ----
      namedRanges: {
        type: "array",
        description:
          "Named ranges for the workbook. Useful for referencing key data areas in formulas. " +
          "Range must include sheet name, e.g. 'Sheet1!A2:A100'.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Range name (e.g. 'Revenue', 'Expenses')" },
            range: { type: "string", description: "Cell range with sheet name (e.g. 'Sheet1!A2:A100')" },
          },
          required: ["name", "range"],
        },
      },
    },
    required: ["title", "sheets"],
  },

  execute: async (toolCtx, args) => {
    const { title, sheets: rawSheets, namedRanges } = args as {
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

    if (!rawSheets || rawSheets.length === 0) {
      return {
        success: false,
        data: null,
        error: "At least one sheet is required.",
      };
    }

    // Sanitize sheet names (Excel rules: max 31 chars, no /\?*[])
    const sheets: XlsxSheet[] = rawSheets.map((s, i) => {
      const safeName = (s.name || `Sheet${i + 1}`)
        .replace(/[/\\?*[\]]/g, "_")
        .slice(0, 31);

      // Coerce cell values to supported types
      const rows = s.rows.map((row) =>
        row.map((cell) => {
          if (cell == null) return null;
          if (typeof cell === "number") return cell;
          if (typeof cell === "boolean") return cell;
          const str = String(cell);
          // Auto-detect numeric strings and convert to numbers
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

    // Generate the .xlsx blob
    const blob = await buildXlsxBlob({ title, sheets, namedRanges });

    // Store in Convex file storage
    const storageId = await toolCtx.ctx.storage.store(blob);
    const url = await toolCtx.ctx.storage.getUrl(storageId);

    // Build summary
    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    const sheetSummary = sheets
      .map((s) => `"${s.name}" (${s.headers.length} cols, ${s.rows.length} rows)`)
      .join(", ");

    const safeTitle = sanitizeFilename(title, "spreadsheet");
    const filename = `${safeTitle}.xlsx`;

    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(filename)}`
      : url;

    return {
      success: true,
      data: {
        storageId,
        downloadUrl,
        filename,
        sheets: sheetSummary,
        totalRows,
        markdownLink: `[${filename}](${downloadUrl})`,
        message:
          `Spreadsheet generated with ${sheets.length} sheet(s) and ${totalRows} data rows. ` +
          `Present the download link to the user using markdown: [${filename}](${downloadUrl})`,
      },
    };
  },
});
