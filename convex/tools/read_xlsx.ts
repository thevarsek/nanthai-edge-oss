// convex/tools/read_xlsx.ts
// =============================================================================
// Tool: read_xlsx — reads an uploaded .xlsx from Convex storage and extracts
// its sheet data, headers, and cell values. The model can use this to
// understand a spreadsheet's contents before summarising, analysing, or editing.
//
// Uses JSZip-based extraction (xlsx_reader.ts) — no heavy libraries needed.
// =============================================================================

import { Id } from "../_generated/dataModel";
import { extractXlsx } from "./xlsx_reader";
import { createTool } from "./registry";

export const readXlsx = createTool({
  name: "read_xlsx",
  description:
    "Read a Microsoft Excel spreadsheet (.xlsx) from storage and extract its " +
    "sheet names, headers, and cell data. Use when the user has uploaded a " +
    ".xlsx file and wants you to read, summarise, analyse, chart, or reference " +
    "its contents. Returns structured data per sheet (headers + rows) plus a " +
    "markdown table representation. Provide the storageId of the uploaded file.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description:
          "The Convex storage ID of the .xlsx file to read (from a file attachment)",
      },
    },
    required: ["storageId"],
  },

  execute: async (toolCtx, args) => {
    if (!args.storageId || typeof args.storageId !== "string") {
      return {
        success: false,
        data: null,
        error: "Missing or invalid 'storageId'",
      };
    }
    const storageId = args.storageId as string;

    let blob: Blob | null;
    try {
      blob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return {
        success: false,
        data: null,
        error: `Invalid storageId: "${storageId}"`,
      };
    }
    if (!blob) {
      return {
        success: false,
        data: null,
        error: `File not found for storageId: "${storageId}"`,
      };
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const extraction = await extractXlsx(arrayBuffer);

      if (extraction.sheets.length === 0) {
        return {
          success: true,
          data: {
            storageId,
            sheetCount: 0,
            sheets: [],
            markdown: "",
            message:
              "The spreadsheet appears to be empty or contains no extractable data.",
          },
        };
      }

      const totalRows = extraction.sheets.reduce(
        (sum, s) => sum + s.totalRows,
        0,
      );
      const sheetSummaries = extraction.sheets.map((s) => ({
        name: s.name,
        headers: s.headers,
        rows: s.rows,
        totalRows: s.totalRows,
        totalCols: s.totalCols,
      }));

      return {
        success: true,
        data: {
          storageId,
          sheetCount: extraction.sheets.length,
          totalRows,
          sheets: sheetSummaries,
          markdown: extraction.markdown,
          message:
            `Successfully read spreadsheet: ${extraction.sheets.length} sheet(s), ` +
            `${totalRows} total data rows.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to parse .xlsx file: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
