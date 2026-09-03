import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { RecordedToolResult } from "../tools/execute_loop";
import { serializeToolResultForStorage } from "../tools/media_tool_result_projection";

const RECOVERABLE_MEDIA_TOOL_NAMES = new Set([
  "generate_image",
  "generate_music",
  "generate_speech",
]);
const RECOVERED_TOOL_RESULT_MAX_CHARS = 4_000;

export interface GeneratedToolMedia {
  generatedFileIds: Id<"generatedFiles">[];
  imageUrls: string[];
  imageMimeTypes: string[];
  imageGenerationResult?: {
    requestedCount: number;
    generatedCount: number;
    failedCount: number;
  };
  videoUrls: string[];
  audio?: {
    storageId: Id<"_storage">;
    generatedFileId?: Id<"generatedFiles">;
    mimeType: string;
    durationMs?: number;
    sizeBytes?: number;
    transcript?: string;
  };
}

function parsedObject(result: RecordedToolResult): Record<string, unknown> | null {
  if (result.isError) return null;
  try {
    const parsed = JSON.parse(result.result) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function recoverGeneratedMediaOperationResults(
  ctx: MutationCtx,
  executionRunId: Id<"executionRuns">,
): Promise<RecordedToolResult[]> {
  const rows = (await Promise.all(
    (["succeeded", "reconciled"] as const).map(async (status) =>
      await ctx.db
        .query("executionOperations")
        .withIndex("by_run_status", (query) => query
          .eq("runId", executionRunId)
          .eq("status", status))
        .collect()
    ),
  )).flat().sort((left, right) => left.updatedAt - right.updatedAt);
  const recovered = new Map<string, RecordedToolResult>();
  for (const row of rows) {
    if (!RECOVERABLE_MEDIA_TOOL_NAMES.has(row.toolName) || !row.resultJson) continue;
    try {
      const result = JSON.parse(row.resultJson) as {
        success?: unknown;
        data?: unknown;
      };
      if (result.success !== true) continue;
      recovered.set(row.toolCallId, {
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        result: serializeToolResultForStorage(
          row.toolName,
          result.data,
          RECOVERED_TOOL_RESULT_MAX_CHARS,
        ),
      });
    } catch {
      // Ignore malformed historical journal entries; normal finalization still
      // uses any valid streaming result that was captured for the same call.
    }
  }
  return Array.from(recovered.values());
}

export function mergeRecoveredToolResults(
  current: RecordedToolResult[],
  recovered: RecordedToolResult[],
): RecordedToolResult[] {
  const replacements = new Map(recovered.map((result) => [result.toolCallId, result]));
  const merged = current.map((result) => {
    const replacement = replacements.get(result.toolCallId);
    replacements.delete(result.toolCallId);
    return replacement ?? result;
  });
  return [...merged, ...replacements.values()];
}

export function extractGeneratedToolMedia(
  toolResults: RecordedToolResult[],
): GeneratedToolMedia {
  const imageUrls: string[] = [];
  const imageMimeTypes: string[] = [];
  const videoUrls: string[] = [];
  let requestedImageCount = 0;
  let generatedImageCount = 0;
  let audio: GeneratedToolMedia["audio"];
  const generatedFileIds: Id<"generatedFiles">[] = [];

  for (const result of toolResults) {
    const data = parsedObject(result);
    if (!data) continue;
    if (result.toolName === "generate_image") {
      const urls = stringArray(data.imageUrls);
      const mimeTypes = stringArray(data.imageMimeTypes);
      for (let index = 0; index < urls.length; index += 1) {
        imageUrls.push(urls[index] ?? "");
        imageMimeTypes.push(mimeTypes[index] ?? "image/url");
      }
      requestedImageCount += finiteNumber(data.requestedCount) ?? urls.length;
      generatedImageCount += finiteNumber(data.generatedCount) ?? urls.length;
    }
    if (result.toolName === "generate_video") {
      videoUrls.push(...stringArray(data.videoUrls));
      if (typeof data.videoUrl === "string" && data.videoUrl) videoUrls.push(data.videoUrl);
    }
    if (result.toolName === "generate_music" || result.toolName === "generate_speech") {
      const generatedFileId = typeof data.generatedFileId === "string"
        ? data.generatedFileId as Id<"generatedFiles">
        : undefined;
      if (generatedFileId) generatedFileIds.push(generatedFileId);
      const storageId = data.audioStorageId ?? data.storageId;
      if (typeof storageId !== "string") continue;
      audio = {
        storageId: storageId as Id<"_storage">,
        generatedFileId,
        mimeType: typeof data.audioMimeType === "string"
          ? data.audioMimeType
          : typeof data.mimeType === "string" ? data.mimeType : "audio/mpeg",
        durationMs: finiteNumber(data.audioDurationMs),
        sizeBytes: finiteNumber(data.sizeBytes),
        transcript: typeof data.audioTranscript === "string" ? data.audioTranscript : undefined,
      };
    }
  }

  const uniqueVideoUrls = Array.from(new Set(videoUrls));
  return {
    generatedFileIds,
    imageUrls,
    imageMimeTypes,
    imageGenerationResult: requestedImageCount > 0
      ? {
          requestedCount: requestedImageCount,
          generatedCount: generatedImageCount,
          failedCount: Math.max(0, requestedImageCount - generatedImageCount),
        }
      : undefined,
    videoUrls: uniqueVideoUrls,
    audio,
  };
}
