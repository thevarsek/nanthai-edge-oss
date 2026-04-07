import { ConvexError } from "convex/values";
import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { callOpenRouterNonStreaming, type OpenRouterMessage } from "../lib/openrouter";
import { MODEL_IDS } from "../lib/model_constants";
import { requireAuth } from "../lib/auth";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { extractDocxContent } from "../tools/docx_reader";
import {
  detectMemoryExclusionRules,
  findDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  parseMemoryExtractionPayload,
  shouldExcludeMemoryContent,
} from "../chat/actions_extract_memories_utils";
import {
  normalizeMemoryCategory,
  normalizeMemoryRecord,
  normalizeMemoryRetrievalMode,
} from "./shared";

export const memoryImportDeps = {
  callOpenRouterNonStreaming,
  getRequiredUserOpenRouterApiKey,
  // Keep this dependency at module scope so tests can control the private
  // extractPlainText path without exporting the helper itself.
  extractDocxContent,
  requireAuth,
};

interface ImportFileDescriptor {
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  textContent?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    output += String.fromCharCode(...chunk);
  }
  return btoa(output);
}

async function ensureProOnAction(ctx: ActionCtx, userId: string): Promise<void> {
  const isPro = await ctx.runQuery(internal.preferences.queries.checkProStatus, {
    userId,
  });
  if (!isPro) {
    throw new ConvexError({
      code: "PRO_REQUIRED" as const,
      message: "This feature requires NanthAI Pro. Upgrade from Settings to unlock it.",
    });
  }
}

async function extractPlainText(file: ImportFileDescriptor, blob: Blob): Promise<string> {
  const mime = file.mimeType.toLowerCase();
  const ext = file.filename.split(".").pop()?.toLowerCase() ?? "";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const extraction = await memoryImportDeps.extractDocxContent(
      new Uint8Array(await blob.arrayBuffer()),
    );
    return extraction.markdown || extraction.text;
  }
  return await blob.text();
}

async function buildImportMessages(
  file: ImportFileDescriptor,
  blob: Blob,
): Promise<OpenRouterMessage[]> {
  const system = `You are curating long-term user memory from an uploaded profile document.
Extract durable, user-centric memories only.
Return JSON only as an array of objects.
Each object must include:
- content
- category: one of identity | writingStyle | work | goals | background | relationships | preferences | tools | skills | logistics
- retrievalMode: one of alwaysOn | contextual | disabled
- importanceScore
- confidenceScore

The document may be a CV, resume, bio, onboarding note, or personal reference doc.
Treat role descriptions, achievements, hobbies, language skills, and education entries as facts about the user even when written as bullet points.
Rewrite extracted content as concise standalone user facts that start with "User".
Prioritize name or preferred name first, then identity, writing style, role/company, location, languages, hobbies, background, founder work, recurring constraints, and long-term goals.
Exclude contact details unless the user explicitly asked to remember them.`;

  if (file.textContent && file.textContent.trim().length > 0) {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Filename: ${file.filename}\nMIME: ${file.mimeType}\n\n` +
          `Document contents:\n${file.textContent.slice(0, 50000)}`,
      },
    ];
  }

  if (file.mimeType.toLowerCase().includes("pdf")) {
    const fileData = `data:${file.mimeType};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract durable memories from this file: ${file.filename}` },
          { type: "file", file: { filename: file.filename, file_data: fileData } },
        ],
      },
    ];
  }

  const extractedText = await extractPlainText(file, blob);
  return [
    { role: "system", content: system },
    {
      role: "user",
      content:
        `Filename: ${file.filename}\nMIME: ${file.mimeType}\n\n` +
        `Document contents:\n${extractedText.slice(0, 50000)}`,
    },
  ];
}

export async function extractImportCandidatesHandler(
  ctx: ActionCtx,
  args: {
    files: ImportFileDescriptor[];
    extractionModel?: string;
    allowContactDetails?: boolean;
  },
): Promise<Array<Record<string, unknown>>> {
  const { userId } = await memoryImportDeps.requireAuth(ctx);
  await ensureProOnAction(ctx, userId);
  const apiKey = await memoryImportDeps.getRequiredUserOpenRouterApiKey(ctx, userId);
  const existingMemories = await ctx.runQuery(internal.chat.queries.getUserMemories, {
    userId,
  });
  const candidates: Array<Record<string, unknown>> = [];
  const exclusionRules = args.allowContactDetails
    ? { excludePhone: false, excludeEmail: false }
    : detectMemoryExclusionRules("Do not save contact details to memory.");

  for (const file of args.files) {
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) continue;

    const messages = await buildImportMessages(file, blob);
    const result = await memoryImportDeps.callOpenRouterNonStreaming(
      apiKey,
      args.extractionModel?.trim() || MODEL_IDS.memoryImportExtraction,
      messages,
      {
        temperature: 0,
        maxTokens: 1200,
        plugins: file.mimeType.toLowerCase().includes("pdf")
          ? [{ id: "file-parser" }]
          : undefined,
      },
      { fallbackModel: MODEL_IDS.memoryExtractionFallback },
    );

    const extracted = parseMemoryExtractionPayload(result.content);
    let keptForFile = 0;
    for (const item of extracted) {
      const normalizedContent = normalizeMemoryContent(item.content ?? "");
      if (!normalizedContent) continue;
      if (!memoryLikelyUserFact(normalizedContent)) continue;
      if (shouldExcludeMemoryContent(normalizedContent, exclusionRules)) continue;
      if (
        findDuplicateMemory(
          normalizedContent,
          [...existingMemories, ...candidates] as Array<{ content: string }>,
        )
      ) {
        continue;
      }

      const category = normalizeMemoryCategory(
        item.category,
        normalizedContent,
        item.memoryType,
      );
      const retrievalMode = normalizeMemoryRetrievalMode(
        item.retrievalMode,
        category,
        item.memoryType,
      );
      const normalized = normalizeMemoryRecord({
        content: normalizedContent,
        category,
        retrievalMode,
        scopeType: "allPersonas",
        sourceType: "import",
        sourceFileName: file.filename,
        tags: item.tags,
      });
      candidates.push({
        id: crypto.randomUUID(),
        content: normalized.content,
        category: normalized.category,
        retrievalMode: normalized.retrievalMode,
        scopeType: normalized.scopeType,
        personaIds: normalized.personaIds,
        tags: normalized.tags,
        isPinned: false,
        sourceFileName: normalized.sourceFileName,
        importanceScore: item.importanceScore ?? 0.88,
        confidenceScore: item.confidenceScore ?? 0.8,
      });
      keptForFile += 1;
    }
    console.info(
      `[memory import] file="${file.filename}" raw=${extracted.length} kept=${keptForFile} textContent=${file.textContent ? "yes" : "no"} model="${args.extractionModel?.trim() || MODEL_IDS.memoryImportExtraction}"`,
    );
  }

  return candidates.slice(0, 32);
}
