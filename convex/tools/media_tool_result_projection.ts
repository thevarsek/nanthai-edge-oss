const MEDIA_TOOL_NAMES = new Set([
  "generate_image",
  "generate_music",
  "generate_speech",
  "generate_video",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function selected(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

function compactMediaResult(
  toolName: string,
  payload: unknown,
): Record<string, unknown> | null {
  if (!MEDIA_TOOL_NAMES.has(toolName)) return null;
  const source = record(payload);
  if (!source) return null;
  if (toolName === "generate_image") {
    const images = Array.isArray(source.images)
      ? source.images.flatMap((value) => {
          const image = record(value);
          return image ? [selected(image, ["storageId", "url", "mimeType", "sizeBytes"])] : [];
        })
      : undefined;
    return {
      ...selected(source, [
        "kind",
        "modelId",
        "requestedCount",
        "generatedCount",
        "imageUrls",
        "imageMimeTypes",
      ]),
      ...(images ? { images } : {}),
      resultTruncated: true,
    };
  }
  if (toolName === "generate_music" || toolName === "generate_speech") {
    return {
      ...selected(source, [
        "kind",
        "modelId",
        "storageId",
        "generatedFileId",
        "audioStorageId",
        "audioUrl",
        "mimeType",
        "audioMimeType",
        "sizeBytes",
        "audioDurationMs",
        "audioTranscript",
        "filename",
        "toolName",
        "voice",
        "speechOptions",
      ]),
      resultTruncated: true,
    };
  }
  return {
    ...selected(source, [
      "kind",
      "status",
      "modelId",
      "videoJobId",
      "storageId",
      "videoStorageId",
      "videoUrl",
      "videoUrls",
      "mimeType",
      "sizeBytes",
      "durationSeconds",
    ]),
    resultTruncated: true,
  };
}

function serializeWithBoundedTranscript(
  compact: Record<string, unknown>,
  maxCharacters: number,
): string | null {
  const transcript = compact.audioTranscript;
  if (typeof transcript !== "string") return null;
  const marker = "…[truncated]";
  let lower = 0;
  let upper = transcript.length;
  let best: string | null = null;
  while (lower <= upper) {
    const midpoint = Math.floor((lower + upper) / 2);
    const serialized = JSON.stringify({
      ...compact,
      audioTranscript: `${transcript.slice(0, midpoint)}${marker}`,
    });
    if (serialized.length <= maxCharacters) {
      best = serialized;
      lower = midpoint + 1;
    } else {
      upper = midpoint - 1;
    }
  }
  return best;
}

export function serializeToolResultForStorage(
  toolName: string,
  payload: unknown,
  maxCharacters: number,
): string {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= maxCharacters) return serialized;
  const compact = compactMediaResult(toolName, payload);
  if (compact) {
    const compactSerialized = JSON.stringify(compact);
    if (compactSerialized.length <= maxCharacters) return compactSerialized;
    const boundedTranscript = serializeWithBoundedTranscript(compact, maxCharacters);
    if (boundedTranscript) return boundedTranscript;
    const ownershipOnly = { ...compact };
    delete ownershipOnly.audioTranscript;
    delete ownershipOnly.speechOptions;
    const ownershipSerialized = JSON.stringify(ownershipOnly);
    if (ownershipSerialized.length <= maxCharacters) return ownershipSerialized;
    return JSON.stringify({ resultTruncated: true });
  }
  return `${serialized.slice(0, maxCharacters)}…[truncated]`;
}
