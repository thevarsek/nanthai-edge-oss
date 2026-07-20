// convex/tools/read_xlsx.ts
// =============================================================================
// Tool: read_xlsx — reads an uploaded .xlsx from Convex storage and extracts
// its sheet data, headers, and cell values. The model can use this to
// understand a spreadsheet's contents before summarising, analysing, or editing.
//
// Uses JSZip-based extraction (xlsx_reader.ts) — no heavy libraries needed.
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { extractXlsx, xlsxReadDefaults } from "./xlsx_reader";
import { createTool } from "./registry";

export const readXlsx = createTool({
  name: "read_xlsx",
  description:
    "Read a Microsoft Excel spreadsheet (.xlsx) from storage and extract its " +
    "sheet names, formulas, typed values, and bounded cell data. Use when the user has uploaded a " +
    ".xlsx file and wants you to read, summarise, analyse, chart, or reference " +
    "its contents. Returns structured data per sheet (headers + rows) plus a " +
    "markdown table representation. For large workbooks, inspect one sheet/range at a time and page with offset/limit. " +
    "Provide the storageId of the uploaded file.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description:
          "The Convex storage ID of the .xlsx file to read (from a file attachment)",
      },
      sheet: {
        type: "string",
        description: "Optional worksheet name. Matching is case-insensitive.",
      },
      range: {
        type: "string",
        description: "Optional bounded A1 range such as A1:H200. The first row of the range is returned as headers.",
      },
      offset: {
        type: "number",
        description: "Zero-based data-row offset within the selected sheet/range or search results.",
      },
      limit: {
        type: "number",
        description: "Maximum data rows to return (default 200, maximum 2000).",
      },
      search: {
        type: "string",
        description: "Optional case-insensitive text filter across cells in the selected sheet/range.",
      },
      includeFormulas: {
        type: "boolean",
        description: "Return formula text instead of cached results when formulas are present (default true).",
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
      if (toolCtx.userId) {
        const owned = await toolCtx.ctx.runQuery(
          internal.runtime.queries.resolveOwnedStorageFileInternal,
          { userId: toolCtx.userId, storageId: storageId as Id<"_storage"> },
        );
        if (!owned) {
          return {
            success: false,
            data: null,
            error: "The requested spreadsheet is not available to this user.",
          };
        }
      }
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
      const defaults = xlsxReadDefaults();
      const extraction = await extractXlsx(arrayBuffer, {
        sheet: typeof args.sheet === "string" ? args.sheet : undefined,
        range: typeof args.range === "string" ? args.range : undefined,
        offset: typeof args.offset === "number" ? args.offset : 0,
        limit: typeof args.limit === "number" ? args.limit : defaults.limit,
        search: typeof args.search === "string" ? args.search : undefined,
        includeFormulas: typeof args.includeFormulas === "boolean" ? args.includeFormulas : true,
      });

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
        rowNumbers: s.rowNumbers,
        totalRows: s.totalRows,
        totalCols: s.totalCols,
        returnedRows: s.returnedRows,
        offset: s.offset,
        hasMore: s.hasMore,
        nextOffset: s.nextOffset,
        range: s.range,
        state: s.state,
      }));

      return {
        success: true,
        data: {
          storageId,
          sheetCount: extraction.sheets.length,
          totalRows,
          bounded: true,
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
