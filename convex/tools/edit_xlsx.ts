// convex/tools/edit_xlsx.ts
// =============================================================================
// Tool: edit_xlsx — applies targeted OOXML patches that preserve unrelated
// workbook parts. Complete sheet rebuilding remains an explicit fallback.
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { patchXlsxBlob } from "./xlsx_patcher";
import { buildXlsxBlob } from "./xlsx_writer";
import { createTool } from "./registry";
import { sanitizeFilename } from "./sanitize";
import { xlsxNamedRangesProperty, xlsxSheetsProperty } from "./xlsx_tool_schema";
import { normalizeXlsxOptions, normalizeXlsxPatchOperations } from "./xlsx_validation";
import { tryCreateXlsxPreview, xlsxPreviewWarnings } from "./xlsx_preview_client";
import { validateXlsxPackage } from "./xlsx_qa";

export const editXlsx = createTool({
  name: "edit_xlsx",
  description:
    "Edit a Microsoft Excel spreadsheet (.xlsx) while preserving unrelated workbook content. " +
    "Prefer operations for targeted changes: setCells, clearRange, appendRows, and renameSheet. " +
    "These patch the original OOXML package so existing styles, charts, validations, hidden sheets, " +
    "and other unsupported parts survive. Full sheets replacement remains available only when the " +
    "user explicitly wants to rebuild the workbook. Use read_xlsx with bounded sheet/range arguments first.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "The Convex storage ID of the original .xlsx file to edit",
      },
      title: {
        type: "string",
        description: "Optional title for the updated filename. Defaults to the original filename for patch edits.",
      },
      sheets: xlsxSheetsProperty,
      namedRanges: xlsxNamedRangesProperty,
      operations: {
        type: "array",
        description: "Targeted preservation-aware workbook edits. Prefer this over full sheets replacement.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Operation type: setCells, clearRange, appendRows, or renameSheet.",
            },
            sheet: { type: "string", description: "Existing worksheet name." },
            startCell: { type: "string", description: "Top-left cell for setCells, e.g. B4." },
            range: { type: "string", description: "A1 range for clearRange." },
            rows: {
              type: "array",
              description: "Rows for setCells or appendRows. Values use the same types as generate_xlsx.",
              items: { type: "array", items: {} },
            },
            startColumn: { type: "number", description: "Zero-based starting column for appendRows." },
            newName: { type: "string", description: "New worksheet name for renameSheet." },
          },
          required: ["type", "sheet"],
        },
      },
      includePreview: {
        type: "boolean",
        description: "Generate a companion PDF preview when runtime context is available (default true).",
      },
    },
    required: ["storageId"],
  },

  execute: async (toolCtx, args) => {
    if (!args.storageId || typeof args.storageId !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'storageId'" };
    }
    const storageId = args.storageId as string;
    const requestedPatchMode = Array.isArray(args.operations) && args.operations.length > 0;
    if (!requestedPatchMode && (!args.title || typeof args.title !== "string")) {
      return { success: false, data: null, error: "Missing or invalid 'title'" };
    }

    // Read the original to verify it exists and is a valid .xlsx
    let originalBlob: Blob | null;
    let originalFilename = "spreadsheet.xlsx";
    try {
      if (toolCtx.userId) {
        const owned = await toolCtx.ctx.runQuery(
          internal.runtime.queries.resolveOwnedStorageFileInternal,
          { userId: toolCtx.userId, storageId: storageId as Id<"_storage"> },
        );
        if (!owned) {
          return { success: false, data: null, error: "The requested spreadsheet is not available to this user." };
        }
        originalFilename = owned.filename;
      }
      originalBlob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return { success: false, data: null, error: `Invalid storageId: "${storageId}"` };
    }
    if (!originalBlob) {
      return { success: false, data: null, error: `File not found for storageId: "${storageId}"` };
    }

    // Verify it is parseable before editing.
    try {
      await validateXlsxPackage(originalBlob);
    } catch (e) {
      return {
        success: false, data: null,
        error: `Original file is not a valid .xlsx: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const patchMode = requestedPatchMode;
    let blob: Blob;
    let title = typeof args.title === "string" && args.title.trim()
      ? args.title.trim()
      : originalFilename.replace(/\.xlsx$/i, "");
    let totalRows = 0;
    let sheetSummary = "Preserved original workbook structure";
    try {
      if (patchMode) {
        const operations = normalizeXlsxPatchOperations(args.operations);
        blob = await patchXlsxBlob(await originalBlob.arrayBuffer(), operations);
        totalRows = operations.reduce((sum, operation) =>
          operation.type === "setCells" || operation.type === "appendRows"
            ? sum + operation.rows.length
            : sum, 0);
        sheetSummary = `${operations.length} targeted operation(s)`;
      } else {
        const workbook = normalizeXlsxOptions({
          title: args.title,
          sheets: args.sheets,
          namedRanges: args.namedRanges,
        });
        title = workbook.title;
        blob = await buildXlsxBlob(workbook);
        totalRows = workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
        sheetSummary = workbook.sheets
          .map((sheet) => `"${sheet.name}" (${sheet.headers.length} cols, ${sheet.rows.length} rows)`)
          .join(", ");
      }
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
    let packageValidation;
    try {
      packageValidation = await validateXlsxPackage(blob);
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Updated workbook validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Store in Convex file storage
    const newStorageId = await toolCtx.ctx.storage.store(blob);
    const preview = await tryCreateXlsxPreview(
      toolCtx,
      newStorageId,
      title,
      args.includePreview !== false,
    );

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
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: blob.size,
        sheets: sheetSummary,
        totalRows,
        editMode: patchMode ? "patch" : "rebuild",
        companionFiles: preview.result ? [preview.result.preview] : [],
        workbookValidation: preview.result?.validation,
        packageValidation,
        warnings: xlsxPreviewWarnings(preview),
        markdownLink: `[${filename}](${downloadUrl})`,
        message:
          `Spreadsheet updated. Present the download link to the user using markdown: [${filename}](${downloadUrl})`,
      },
    };
  },
});
