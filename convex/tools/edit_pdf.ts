"use node";

import { editPdfDocument } from "../runtime/service_pdf";
import { createTool } from "./registry";

export const editPdf = createTool({
  name: "edit_pdf",
  description:
    "Regenerate a revised PDF from an existing uploaded PDF. " +
    "Use this for edit-by-rebuild workflows, not low-level in-place PDF patching.",
  parameters: {
    type: "object",
    properties: {
      storageId: { type: "string", description: "Convex storage ID of the source PDF." },
      title: { type: "string", description: "Title for the regenerated PDF." },
      filename: { type: "string", description: "Optional output filename." },
      author: { type: "string", description: "Optional document author metadata." },
      sections: {
        type: "array",
        description: "Ordered sections for the regenerated PDF.",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
          },
          required: ["body"],
          additionalProperties: false,
        },
      },
    },
    required: ["storageId", "title", "sections"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const storageId = String(args.storageId ?? "").trim();
    const title = String(args.title ?? "").trim();
    const sections = Array.isArray(args.sections)
      ? (args.sections as Array<{ heading?: string; body: string }>)
      : [];
    if (!storageId) {
      return { success: false, data: null, error: "Missing storageId." };
    }
    if (!title) {
      return { success: false, data: null, error: "Missing title." };
    }
    if (sections.length === 0) {
      return { success: false, data: null, error: "Provide at least one section." };
    }

    try {
      return {
        success: true,
        data: await editPdfDocument(toolCtx, {
          storageId,
          title,
          filename: typeof args.filename === "string" ? args.filename : undefined,
          author: typeof args.author === "string" ? args.author : undefined,
          sections,
        }),
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
