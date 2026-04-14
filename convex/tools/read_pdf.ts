"use node";

import { readPdfFromStorage } from "../runtime/service_pdf";
import { createTool } from "./registry";

export const readPdf = createTool({
  name: "read_pdf",
  description:
    "Read a PDF from NanthAI storage using the persistent Python runtime. " +
    "Use this when OpenRouter PDF attachment parsing is unavailable, insufficient, " +
    "or when you need page-aware extraction for a user-uploaded PDF.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "Convex storage ID of the uploaded PDF file.",
      },
    },
    required: ["storageId"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const storageId = String(args.storageId ?? "").trim();
    if (!storageId) {
      return { success: false, data: null, error: "Missing storageId." };
    }

    try {
      return {
        success: true,
        data: await readPdfFromStorage(toolCtx, storageId),
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
