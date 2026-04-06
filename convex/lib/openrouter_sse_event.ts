import {
  extractFirstTextFromUnknown,
  extractFirstStreamingTextFromUnknown,
  extractImageUrlsFromUnknown,
  extractTextAndImages,
  usageFromUnknown,
} from "./openrouter_extract";
import { extractErrorMessage } from "./openrouter_error";
import { OpenRouterUsage, PerplexityAnnotation, ToolCallDelta } from "./openrouter_types";
import { SSEEvent, SSEEventResult } from "./openrouter_sse_types";

interface ReasoningDetail {
  type?: string;
  text?: string;
  summary?: string;
  data?: string;
}

/**
 * Extract displayable reasoning text from a reasoning_details array.
 * OpenRouter sends reasoning as typed objects: "reasoning.text" (plain text),
 * "reasoning.summary" (summary), or "reasoning.encrypted" (opaque, skipped).
 */
function extractReasoningFromDetails(
  details: ReasoningDetail[] | undefined | null,
): string | undefined {
  if (!Array.isArray(details) || details.length === 0) return undefined;
  const parts: string[] = [];
  for (const entry of details) {
    if (entry.type === "reasoning.text" && entry.text) {
      const trimmed = entry.text.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
    } else if (entry.type === "reasoning.summary" && entry.summary) {
      const trimmed = entry.summary.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function* parseSSELines(text: string): Generator<SSEEvent> {
  const lines = text.split("\n");
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  for (const line of lines) {
    if (line === "") {
      if (dataLines.length > 0) {
        yield { event: currentEvent, data: dataLines.join("\n") };
        currentEvent = undefined;
        dataLines = [];
      }
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length > 0) {
    yield { event: currentEvent, data: dataLines.join("\n") };
  }
}

export function processSSEEvent(event: SSEEvent): SSEEventResult {
  if (event.data === "[DONE]") {
    return { done: true, terminal: true };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    return {};
  }

  if (parsed.error) {
    return { error: extractErrorMessage(parsed) };
  }

  const payloadType =
    typeof parsed.type === "string" ? parsed.type.toLowerCase() : undefined;
  const eventType = payloadType ?? event.event?.toLowerCase();

  if (eventType) {
    switch (eventType) {
      case "state": {
        const rawState = (parsed as { state?: string }).state;
        const state = rawState?.toLowerCase();
        if (state === "error") {
          return { error: extractErrorMessage(parsed) };
        }
        if (
          state === "complete" ||
          state === "completed" ||
          state === "done"
        ) {
          return { done: true };
        }
        return {};
      }
      case "chunk": {
        const payload = parsed as {
          content?: unknown;
          reasoning?: string;
          images?: unknown;
          output?: unknown;
        };
        const parsedContent = extractTextAndImages(payload.content);
        const images = [
          ...parsedContent.imageUrls,
          ...extractImageUrlsFromUnknown(payload.images),
          ...extractImageUrlsFromUnknown(payload.output),
        ];

        return {
          contentDelta: parsedContent.text,
          reasoningDelta: payload.reasoning || undefined,
          imageUrls:
            images.length > 0 ? Array.from(new Set(images)) : undefined,
        };
      }
      case "complete": {
        const payload = parsed as {
          content?: string;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        return {
          contentDelta: payload.content || undefined,
          usage: payload.usage
            ? {
                promptTokens: payload.usage.prompt_tokens ?? 0,
                completionTokens: payload.usage.completion_tokens ?? 0,
                totalTokens: payload.usage.total_tokens ?? 0,
              }
            : undefined,
          done: true,
        };
      }
      case "error": {
        return { error: extractErrorMessage(parsed) };
      }
      case "response.output_text.delta": {
        const delta = (parsed as { delta?: string }).delta;
        return { contentDelta: delta || undefined };
      }
      case "response.output_text.done": {
        const text =
          (parsed as { text?: string; delta?: string }).text ??
          (parsed as { text?: string; delta?: string }).delta;
        return { contentDelta: text || undefined };
      }
      case "response.reasoning.delta": {
        const delta = (parsed as { delta?: string }).delta;
        return { reasoningDelta: delta || undefined };
      }
      case "response.reasoning.done": {
        const reasoning =
          (parsed as { reasoning?: string; delta?: string }).reasoning ??
          (parsed as { reasoning?: string; delta?: string }).delta;
        return { reasoningDelta: reasoning || undefined };
      }
      case "response.output_image.delta":
      case "response.output_image.done":
      case "response.image.delta":
      case "response.image.done": {
        const images = [
          ...extractImageUrlsFromUnknown((parsed as { image?: unknown }).image),
          ...extractImageUrlsFromUnknown((parsed as { images?: unknown }).images),
          ...extractImageUrlsFromUnknown(
            (parsed as { image_url?: unknown }).image_url,
          ),
          ...extractImageUrlsFromUnknown((parsed as { delta?: unknown }).delta),
        ];
        return {
          imageUrls:
            images.length > 0 ? Array.from(new Set(images)) : undefined,
        };
      }
      case "response.output_item.added":
      case "response.output_item.done":
      case "response.output_item.delta":
      case "response.content_part.added":
      case "response.content_part.done":
      case "response.content_part.delta": {
        const payload = parsed as {
          item?: unknown;
          part?: unknown;
          content?: unknown;
          delta?: unknown;
          output?: unknown;
          response?: unknown;
          reasoning?: string;
        };
        const parsedItem = extractTextAndImages(payload.item);
        const parsedPart = extractTextAndImages(payload.part);
        const parsedContent = extractTextAndImages(payload.content);
        const parsedDelta = extractTextAndImages(payload.delta);
        const parsedOutput = extractTextAndImages(payload.output);
        const parsedResponse = extractTextAndImages(payload.response);
        const contentDelta = [
          parsedPart.text,
          parsedItem.text,
          parsedContent.text,
          parsedDelta.text,
          extractFirstStreamingTextFromUnknown(payload.delta),
          parsedOutput.text,
          parsedResponse.text,
        ].find((text) => typeof text === "string" && text.length > 0);
        const images = [
          ...parsedPart.imageUrls,
          ...parsedItem.imageUrls,
          ...parsedContent.imageUrls,
          ...parsedDelta.imageUrls,
          ...parsedOutput.imageUrls,
          ...parsedResponse.imageUrls,
          ...extractImageUrlsFromUnknown(payload.item),
          ...extractImageUrlsFromUnknown(payload.part),
          ...extractImageUrlsFromUnknown(payload.delta),
          ...extractImageUrlsFromUnknown(payload.output),
          ...extractImageUrlsFromUnknown(payload.response),
        ];
        return {
          contentDelta,
          reasoningDelta: payload.reasoning || undefined,
          imageUrls:
            images.length > 0 ? Array.from(new Set(images)) : undefined,
        };
      }
      case "response.completed": {
        const payload = parsed as {
          content?: unknown;
          output?: unknown;
          response?: { output?: unknown; usage?: unknown } | unknown;
          usage?: unknown;
        };
        const parsedContent = extractTextAndImages(payload.content);
        const parsedOutput = extractTextAndImages(payload.output);
        const responseObject =
          payload.response && typeof payload.response === "object"
            ? (payload.response as { output?: unknown; usage?: unknown })
            : undefined;
        const parsedResponseOutput = extractTextAndImages(responseObject?.output);
        const images = [
          ...parsedContent.imageUrls,
          ...parsedOutput.imageUrls,
          ...parsedResponseOutput.imageUrls,
          ...extractImageUrlsFromUnknown(payload.output),
          ...extractImageUrlsFromUnknown(responseObject?.output),
          ...extractImageUrlsFromUnknown(payload.response),
        ];
        return {
          contentDelta:
            parsedContent.text ?? parsedOutput.text ?? parsedResponseOutput.text,
          usage:
            usageFromUnknown(payload.usage) ??
            usageFromUnknown(responseObject?.usage),
          imageUrls:
            images.length > 0 ? Array.from(new Set(images)) : undefined,
          done: true,
        };
      }
      case "response.failed":
      case "response.error": {
        return { error: extractErrorMessage(parsed) };
      }
    }
  }

  const choices = parsed.choices as
    | Array<{
        delta?: {
          content?: unknown;
          reasoning?: string;
          reasoning_content?: string;
          reasoning_details?: ReasoningDetail[];
          audio?: {
            data?: string;
            transcript?: string;
          };
          images?: unknown;
          tool_calls?: ToolCallDelta[];
          /** Perplexity sends annotations (url_citation) on delta chunks. */
          annotations?: unknown[];
        };
        message?: {
          content?: unknown;
          reasoning?: string;
          reasoning_details?: ReasoningDetail[];
          images?: unknown;
          tool_calls?: ToolCallDelta[];
          /** Perplexity non-streaming: annotations on the message itself. */
          annotations?: unknown[];
        };
        finish_reason?: string;
      }>
    | undefined;

  if (choices && choices.length > 0) {
    const choice = choices[0];
    const delta = choice.delta;

    const result: SSEEventResult = {};

    // Capture the OpenRouter generation ID from the top-level `id` field.
    // It is present on every chunk; we only need it once so callers can
    // store the first non-empty value they see.
    const chunkId = typeof parsed.id === "string" && parsed.id.length > 0
      ? parsed.id
      : undefined;
    if (chunkId) result.generationId = chunkId;

    const parsedContent = extractTextAndImages(
      delta?.content ?? choice.message?.content,
    );
    if (parsedContent.text) {
      result.contentDelta = parsedContent.text;
    }
    if (delta?.audio?.data) {
      result.audioDelta = delta.audio.data;
    }
    if (delta?.audio?.transcript) {
      result.audioTranscriptDelta = delta.audio.transcript;
    }

    const images = [
      ...parsedContent.imageUrls,
      ...extractImageUrlsFromUnknown(delta?.images),
      ...extractImageUrlsFromUnknown(choice.message?.images),
    ];
    if (images.length > 0) {
      result.imageUrls = Array.from(new Set(images));
    }

    // Extract reasoning: direct fields first, then reasoning_details fallback.
    const reasoningDelta =
      delta?.reasoning ?? delta?.reasoning_content ?? choice.message?.reasoning;
    if (reasoningDelta) {
      result.reasoningDelta = reasoningDelta;
    } else {
      const fromDetails = extractReasoningFromDetails(
        delta?.reasoning_details ?? choice.message?.reasoning_details,
      );
      if (fromDetails) {
        result.reasoningDelta = fromDetails;
      }
    }

    // Extract tool-call deltas (streaming) or complete tool calls (non-streaming).
    const rawToolCalls = delta?.tool_calls ?? choice.message?.tool_calls;
    if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
      result.toolCallDeltas = rawToolCalls;
    }

    // Extract Perplexity annotations (url_citation) from delta or message.
    // Streaming: annotations arrive on separate delta chunks at the beginning.
    // Non-streaming: annotations are on the message object.
    const rawAnnotations = delta?.annotations ?? choice.message?.annotations;
    if (Array.isArray(rawAnnotations) && rawAnnotations.length > 0) {
      const validAnnotations: PerplexityAnnotation[] = [];
      for (const ann of rawAnnotations) {
        if (
          ann &&
          typeof ann === "object" &&
          (ann as Record<string, unknown>).type === "url_citation" &&
          (ann as Record<string, unknown>).url_citation &&
          typeof ((ann as Record<string, unknown>).url_citation as Record<string, unknown>)?.url === "string"
        ) {
          validAnnotations.push(ann as PerplexityAnnotation);
        }
      }
      if (validAnnotations.length > 0) {
        result.annotations = validAnnotations;
      }
    }

    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
      result.done = true;
    }

    // OpenRouter sends usage on the same final chunk as finish_reason, at the
    // top level alongside `choices`.  Extract it here so it isn't dropped when
    // we return early from the choices branch.
    const chunkUsage = usageFromUnknown(parsed.usage);
    if (chunkUsage) {
      result.usage = chunkUsage;
    }

    return result;
  }

  const usage = usageFromUnknown(parsed.usage);
  if (usage) {
    return { usage };
  }

  return {};
}

export function extractContentFromNonStreamingPayload(
  parsed: Record<string, unknown>,
): {
    content: string;
    finishReason: string | null;
    usage: OpenRouterUsage | null;
    audioBase64: string;
    audioTranscript: string;
  } {
  const choices = parsed.choices as
    | Array<{
        message?: {
          content?: unknown;
          text?: string;
          audio?: { data?: string; transcript?: string };
        };
        text?: string;
        finish_reason?: string;
      }>
    | undefined;

  const messageAudio = choices?.[0]?.message?.audio;
  const finishReason = choices?.[0]?.finish_reason ?? null;
  const content =
    extractFirstTextFromUnknown(choices?.[0]?.message?.content) ??
    extractFirstTextFromUnknown(choices?.[0]?.message) ??
    extractFirstTextFromUnknown(choices?.[0]?.text) ??
    extractFirstTextFromUnknown(parsed.output_text) ??
    extractFirstTextFromUnknown(parsed.output) ??
    extractFirstTextFromUnknown(parsed.response) ??
    extractFirstTextFromUnknown(parsed.content) ??
    "";

  const usage =
    usageFromUnknown(parsed.usage) ??
    usageFromUnknown(
      parsed.response && typeof parsed.response === "object"
        ? (parsed.response as Record<string, unknown>).usage
        : undefined,
    );

  return {
    content,
    finishReason,
    usage: usage ?? null,
    audioBase64: typeof messageAudio?.data === "string" ? messageAudio.data : "",
    audioTranscript:
      typeof messageAudio?.transcript === "string"
        ? messageAudio.transcript
        : "",
  };
}
