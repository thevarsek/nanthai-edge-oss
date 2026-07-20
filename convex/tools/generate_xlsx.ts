// convex/tools/generate_xlsx.ts
// =============================================================================
// Tool: generate_xlsx — creates an Excel spreadsheet and stores it in Convex
// file storage. Returns a download URL the model can present to the user.
//
// Uses a custom JSZip-based OOXML writer (xlsx_writer.ts) so it works in
// Convex's default V8 runtime without "use node".
//
// Extended capabilities include typed cells, formulas, compositional styling,
// conditional formatting, data validation, panes, filters, named ranges,
// deterministic package QA, and a best-effort companion PDF preview.
// =============================================================================

import { createTool } from "./registry";
import { buildXlsxBlob } from "./xlsx_writer";
import { normalizeXlsxOptions } from "./xlsx_validation";
import { sanitizeFilename } from "./sanitize";
import { xlsxNamedRangesProperty, xlsxSheetsProperty } from "./xlsx_tool_schema";
import { tryCreateXlsxPreview, xlsxPreviewWarnings } from "./xlsx_preview_client";
import { validateXlsxPackage } from "./xlsx_qa";

export const generateXlsx = createTool({
  name: "generate_xlsx",
  description:
    "Generate a Microsoft Excel spreadsheet (.xlsx) with one or more worksheets. " +
    "Use for data tables, reports, budgets, trackers, calculations, or any tabular " +
    "content the user wants as a downloadable Excel file. Each sheet has a name, " +
    "headers, and data rows. Cells can contain text, numbers, booleans, or formulas " +
    "(prefix with '='). Numbers are stored as numeric values for proper sorting and " +
    "calculation in Excel. Supports cell styling, number formats, validation, conditional formatting, " +
    "filters, freeze panes, named ranges, and explicit dimensions. All formatting params are optional " +
    "with sensible defaults.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Spreadsheet title (used for the filename, e.g. 'Q1 Budget')",
      },
      sheets: xlsxSheetsProperty,
      namedRanges: xlsxNamedRangesProperty,
      includePreview: {
        type: "boolean",
        description: "Generate a companion PDF preview when runtime context is available (default true).",
      },
    },
    required: ["title", "sheets"],
  },

  execute: async (toolCtx, args) => {
    let workbook;
    try {
      workbook = normalizeXlsxOptions({
        title: args.title,
        sheets: args.sheets,
        namedRanges: args.namedRanges,
      });
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const { title, sheets } = workbook;

    // Generate the .xlsx blob
    const blob = await buildXlsxBlob(workbook);
    let packageValidation;
    try {
      packageValidation = await validateXlsxPackage(blob);
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Generated workbook validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Store in Convex file storage
    const storageId = await toolCtx.ctx.storage.store(blob);
    const url = await toolCtx.ctx.storage.getUrl(storageId);
    const preview = await tryCreateXlsxPreview(
      toolCtx,
      storageId,
      title,
      args.includePreview !== false,
    );

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
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: blob.size,
        companionFiles: preview.result ? [preview.result.preview] : [],
        workbookValidation: preview.result?.validation,
        packageValidation,
        warnings: xlsxPreviewWarnings(preview),
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
