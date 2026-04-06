// convex/tools/generate_text_file.ts
// =============================================================================
// Tool: generate_text_file — creates a plain-text file (.csv, .txt, or .md)
// and stores it in Convex file storage. Returns a download URL.
//
// All three formats are fundamentally UTF-8 text. The `format` parameter
// controls the file extension and MIME type.
// =============================================================================

import { createTool } from "./registry";

const FORMAT_META: Record<string, { ext: string; mime: string }> = {
  csv: { ext: "csv", mime: "text/csv" },
  txt: { ext: "txt", mime: "text/plain" },
  md: { ext: "md", mime: "text/markdown" },
};

export const generateTextFile = createTool({
  name: "generate_text_file",
  description:
    "Generate a plain-text file (.csv, .txt, or .md) with the given content. " +
    "Use for CSV data exports, plain text notes, Markdown documents, or any " +
    "content the user wants as a downloadable text file. For CSV, provide " +
    "properly formatted comma-separated values with headers in the first row.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "Desired filename WITHOUT extension (e.g. 'sales_report'). " +
          "The correct extension (.csv, .txt, .md) is appended automatically.",
      },
      format: {
        type: "string",
        enum: ["csv", "txt", "md"],
        description:
          "File format: 'csv' for comma-separated values, 'txt' for plain text, 'md' for Markdown.",
      },
      content: {
        type: "string",
        description:
          "The full file content as a string. For CSV, include header row and " +
          "data rows separated by newlines. For Markdown, use standard Markdown syntax.",
      },
    },
    required: ["filename", "format", "content"],
  },

  execute: async (toolCtx, args) => {
    if (!args.filename || typeof args.filename !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'filename'" };
    }
    if (!args.format || typeof args.format !== "string" || !FORMAT_META[args.format as string]) {
      return {
        success: false,
        data: null,
        error: `Invalid format '${args.format}'. Must be one of: csv, txt, md`,
      };
    }
    if (args.content == null || typeof args.content !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'content'" };
    }

    const filename = args.filename as string;
    const format = args.format as string;
    const content = args.content as string;

    const meta = FORMAT_META[format];
    const safeFilename =
      filename.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "file";
    const fullFilename = `${safeFilename}.${meta.ext}`;

    // Store as Blob with correct MIME type.
    const blob = new Blob([content], { type: meta.mime });
    const storageId = await toolCtx.ctx.storage.store(blob);

    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(fullFilename)}`
      : await toolCtx.ctx.storage.getUrl(storageId);

    return {
      success: true,
      data: {
        storageId,
        downloadUrl,
        filename: fullFilename,
        markdownLink: `[${fullFilename}](${downloadUrl})`,
        message: `File generated. Present the download link to the user using markdown: [${fullFilename}](${downloadUrl})`,
      },
    };
  },
});
