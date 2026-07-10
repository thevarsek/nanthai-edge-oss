import { MAX_IMAGE_RESPONSE_OBJECT_CHARS } from "./openrouter_image_limits";

export interface OpenRouterImagePayload {
  base64: string;
  mediaType: string;
}

export interface ParsedOpenRouterImageResponse {
  imageCount: number;
  usage?: unknown;
  error?: unknown;
}

const DATA_ARRAY_PATTERN = /"data"\s*:\s*\[/;
const MAX_METADATA_CHARS = 1_000_000;

interface ImageResponseParserLimits {
  /** Test seam; production always uses the bounded default. */
  maxObjectChars?: number;
}

function parseMetadata(prefix: string, tail: string): {
  usage?: unknown;
  error?: unknown;
} {
  if (!tail) {
    try {
      const payload = JSON.parse(prefix) as { usage?: unknown; error?: unknown };
      return { usage: payload.usage, error: payload.error };
    } catch {
      return {};
    }
  }

  try {
    const payload = JSON.parse(`{"data":[]${tail}`) as {
      usage?: unknown;
      error?: unknown;
    };
    return { usage: payload.usage, error: payload.error };
  } catch {
    return {};
  }
}

/**
 * Parse the dedicated Images API response one data-array item at a time.
 *
 * Image responses can contain ten large base64 strings. Reading the full body
 * with `response.text()` and then `JSON.parse()` keeps several copies alive and
 * can exceed the Node action memory limit. This parser retains at most one
 * image object while back-pressuring the response during persistence.
 */
export async function parseOpenRouterImageResponse(
  response: Response,
  onImage: (image: OpenRouterImagePayload) => Promise<void>,
  limits: ImageResponseParserLimits = {},
): Promise<ParsedOpenRouterImageResponse> {
  if (!response.body) {
    const payload = await response.json() as {
      data?: Array<{ b64_json?: string; media_type?: string }>;
      usage?: unknown;
      error?: unknown;
    };
    let imageCount = 0;
    for (const image of payload.data ?? []) {
      if (typeof image.b64_json !== "string" || image.b64_json.length === 0) {
        continue;
      }
      await onImage({
        base64: image.b64_json,
        mediaType: image.media_type?.trim() || "image/png",
      });
      imageCount += 1;
    }
    return { imageCount, usage: payload.usage, error: payload.error };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let prefix = "";
  const tailParts: string[] = [];
  let readingData = false;
  let finishedData = false;
  let objectParts: string[] | undefined;
  let objectChars = 0;
  let objectDepth = 0;
  let inString = false;
  let escaped = false;
  let imageCount = 0;
  let tailChars = 0;
  const maxObjectChars = limits.maxObjectChars ??
    MAX_IMAGE_RESPONSE_OBJECT_CHARS;

  const appendTail = (value: string): void => {
    if (!value) return;
    tailChars += value.length;
    if (tailChars > MAX_METADATA_CHARS) {
      throw new Error("OpenRouter image response metadata was too large.");
    }
    tailParts.push(value);
  };

  const appendObjectPart = (value: string): void => {
    if (!value) return;
    objectChars += value.length;
    if (objectChars > maxObjectChars) {
      throw new Error("OpenRouter image payload exceeded the safe size limit.");
    }
    objectParts?.push(value);
  };

  const emitObject = async (serialized: string): Promise<void> => {
    const image = JSON.parse(serialized) as {
      b64_json?: unknown;
      media_type?: unknown;
    };
    if (typeof image.b64_json !== "string" || image.b64_json.length === 0) {
      return;
    }
    await onImage({
      base64: image.b64_json,
      mediaType: typeof image.media_type === "string" && image.media_type.trim()
        ? image.media_type.trim()
        : "image/png",
    });
    imageCount += 1;
  };

  const processDataChunk = async (chunk: string): Promise<void> => {
    let segmentStart = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];

      if (!objectParts) {
        if (character === "{") {
          objectParts = [];
          objectDepth = 1;
          inString = false;
          escaped = false;
          objectChars = 0;
          segmentStart = index;
        } else if (character === "]") {
          readingData = false;
          finishedData = true;
          appendTail(chunk.slice(index + 1));
          return;
        }
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        objectDepth += 1;
      } else if (character === "}") {
        objectDepth -= 1;
        if (objectDepth === 0) {
          appendObjectPart(chunk.slice(segmentStart, index + 1));
          const serialized = objectParts.join("");
          objectParts = undefined;
          objectChars = 0;
          segmentStart = index + 1;
          await emitObject(serialized);
        }
      }
    }

    if (objectParts) {
      appendObjectPart(chunk.slice(segmentStart));
    }
  };

  const processChunk = async (chunk: string): Promise<void> => {
    if (finishedData) {
      appendTail(chunk);
      return;
    }
    if (readingData) {
      await processDataChunk(chunk);
      return;
    }

    prefix += chunk;
    const match = DATA_ARRAY_PATTERN.exec(prefix);
    if (!match) {
      if (prefix.length > MAX_METADATA_CHARS) {
        throw new Error("OpenRouter image response did not contain a data array.");
      }
      return;
    }

    const dataStart = match.index + match[0].length;
    const remainder = prefix.slice(dataStart);
    prefix = prefix.slice(0, match.index);
    readingData = true;
    await processDataChunk(remainder);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await processChunk(decoder.decode(value, { stream: true }));
    }
    const finalChunk = decoder.decode();
    if (finalChunk) await processChunk(finalChunk);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (objectParts || readingData || (!finishedData && imageCount > 0)) {
    throw new Error("OpenRouter image response ended before the data array completed.");
  }

  const metadata = parseMetadata(prefix, tailParts.join(""));
  return {
    imageCount,
    usage: metadata.usage,
    error: metadata.error,
  };
}
