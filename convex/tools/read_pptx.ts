// convex/tools/read_pptx.ts
// =============================================================================
// Tool: read_pptx — reads an uploaded .pptx from Convex storage and extracts
// its text content and slide structure. The model can use this to understand a
// presentation's contents before summarising, analysing, or editing it.
//
// Uses JSZip-based extraction (pptx_reader.ts) — no heavy libraries needed.
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { extractPptxContent } from "./pptx_reader";
import { storePptxReferenceImages } from "./pptx_reference_assets";
import { createTool } from "./registry";

export const readPptx = createTool({
  name: "read_pptx",
  description:
    "Read a Microsoft PowerPoint presentation (.pptx) from storage and extract " +
    "its text content and slide structure. Use when the user has uploaded a " +
    ".pptx file and wants you to read, summarise, analyse, or reference its " +
    "contents. Returns slide titles, body text, speaker notes, and a markdown " +
    "representation plus visual traits (layout, normalized geometry, theme, and reusable embedded images). " +
    "Provide the storageId of the uploaded file.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description:
          "The Convex storage ID of the .pptx file to read (from a file attachment)",
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
      const owned = await toolCtx.ctx.runQuery(
        internal.runtime.queries.resolveOwnedStorageFileInternal,
        {
          userId: toolCtx.userId,
          storageId: storageId as Id<"_storage">,
        },
      );
      if (!owned) {
        return {
          success: false,
          data: null,
          error: "The requested presentation is not available to this user.",
        };
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
      const extraction = await extractPptxContent(arrayBuffer);
      const referenceImages = await storePptxReferenceImages(
        toolCtx,
        storageId as Id<"_storage">,
        extraction.embeddedImages,
      );

      if (!extraction.text) {
        return {
          success: true,
          data: {
            storageId,
            slideCount: extraction.slideCount,
            text: "",
            markdown: "",
            slides: [],
            referenceTraits: extraction.referenceTraits,
            referenceImages,
            message:
              "The presentation appears to be empty or contains no extractable text.",
          },
        };
      }

      // Build a concise slide summary for the model
      const slideSummaries = extraction.slides.map((s) => ({
        slideNumber: s.slideNumber,
        title: s.title,
        bodyText: s.text,
        hasNotes: s.notesText.length > 0,
        notesText: s.notesText || undefined,
      }));

      return {
        success: true,
        data: {
          storageId,
          slideCount: extraction.slideCount,
          wordCount: extraction.wordCount,
          text: extraction.text,
          markdown: extraction.markdown,
          slides: slideSummaries,
          referenceTraits: extraction.referenceTraits,
          referenceImages,
          message:
            `Successfully read presentation: ${extraction.slideCount} slides, ${extraction.wordCount} words, ${referenceImages.length} reusable images.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to parse .pptx file: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
