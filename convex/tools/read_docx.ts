// convex/tools/read_docx.ts
// =============================================================================
// Tool: read_docx — reads an uploaded .docx from Convex storage and extracts
// its text content. The model can use this to understand a document's contents
// before summarising, analysing, or editing it.
//
// Uses JSZip-based extraction (docx_reader.ts) instead of mammoth, which
// depends on bluebird and uses `new Function()` — banned in Convex V8.
// =============================================================================

import { Id } from "../_generated/dataModel";
import { extractDocxContent } from "./docx_reader";
import { createTool } from "./registry";

export const readDocx = createTool({
  name: "read_docx",
  description:
    "Read a Microsoft Word document (.docx) from storage and extract its text content. " +
    "Use when the user has uploaded a .docx file and wants you to read, summarise, " +
    "analyse, or reference its contents. Provide the storageId of the uploaded file.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description:
          "The Convex storage ID of the .docx file to read (from a file attachment)",
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
      return { success: false, data: null, error: `Invalid storageId: "${storageId}"` };
    }
    if (!blob) {
      return { success: false, data: null, error: `File not found for storageId: "${storageId}"` };
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const extraction = await extractDocxContent(arrayBuffer);

      if (!extraction.text) {
        return {
          success: true,
          data: {
            storageId,
            text: "",
            markdown: "",
            message: "The document appears to be empty or contains no extractable text.",
          },
        };
      }

      return {
        success: true,
        data: {
          storageId,
          text: extraction.text,
          markdown: extraction.markdown,
          wordCount: extraction.wordCount,
          message: `Successfully read document (${extraction.wordCount} words).`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to parse .docx file: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
