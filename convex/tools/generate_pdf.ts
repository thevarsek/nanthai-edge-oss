"use node";

import { generatePdfDocument } from "../runtime/service_pdf";
import { createTool } from "./registry";

export const generatePdf = createTool({
  name: "generate_pdf",
  description:
    "Generate a PDF in NanthAI's persistent Python runtime. " +
    "Use this for reports, summaries, formatted exports, and other durable PDF deliverables.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Document title." },
      filename: { type: "string", description: "Optional output filename." },
      author: { type: "string", description: "Optional document author metadata." },
      sections: {
        type: "array",
        description: "Ordered PDF sections to render.",
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
    required: ["title", "sections"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const title = String(args.title ?? "").trim();
    const sections = Array.isArray(args.sections)
      ? (args.sections as Array<{ heading?: string; body: string }>)
      : [];
    if (!title) {
      return { success: false, data: null, error: "Missing title." };
    }
    if (sections.length === 0) {
      return { success: false, data: null, error: "Provide at least one section." };
    }

    try {
      return {
        success: true,
        data: await generatePdfDocument(toolCtx, {
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
