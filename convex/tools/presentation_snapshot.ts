"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { getProjectWithSlidesInternalRef } from "../presentations/action_refs";
import type { PresentationProjectDoc, PresentationSlideDoc } from "../presentations/types";
import { generatePptx } from "./generate_pptx";
import type { ToolExecutionContext, ToolResult } from "./registry";

export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function slideTextFromHtml(html: string): string {
  const text = html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|h1|h2|h3|div|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n")
    .slice(0, 4_000);
}

export async function createPptxSnapshot(
  toolCtx: ToolExecutionContext,
  project: PresentationProjectDoc,
  slides: PresentationSlideDoc[],
): Promise<ToolResult> {
  return await generatePptx.execute(toolCtx, {
    title: project.title,
    slides: slides.map((slide, index) => ({
      title: slide.title,
      body: slideTextFromHtml(slide.html),
      notes: slide.notes,
      layout: project.plan?.[index]?.layout.toLowerCase().includes("section")
        ? "section"
        : "text",
    })),
    showSlideNumbers: true,
    includeTitleSlide: false,
  });
}

export const createPresentationSnapshot = internalAction({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ToolResult> => {
    const presentation = await ctx.runQuery(getProjectWithSlidesInternalRef, args);
    if (!presentation) {
      return { success: false, data: null, error: "Presentation not found or unauthorized." };
    }
    return await createPptxSnapshot(
      { ctx, userId: args.userId },
      presentation.project,
      presentation.slides,
    );
  },
});
