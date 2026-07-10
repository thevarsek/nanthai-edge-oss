import type { OpenRouterMessage } from "../lib/openrouter_types";
import type {
  AdvisorOutputItem,
  AdvisorResponsesInputItem,
} from "../lib/openrouter_responses_types";
import { MAX_ADVISOR_HISTORY_BYTES } from "./constants";

export function advisorResponsesInput(
  messages: OpenRouterMessage[],
  replayItems: unknown[],
  brief: string,
  capabilities: {
    allowImages?: boolean;
    allowFiles?: boolean;
    forwardTranscript?: boolean;
  } = {
    allowImages: true,
    allowFiles: true,
    forwardTranscript: true,
  },
): AdvisorResponsesInputItem[] {
  const converted = messages.flatMap((message, index) =>
    convertMessage(message, index, capabilities)
  );
  const lastUserIndex = converted.findLastIndex((item) =>
    item.type === "message" && item.role === "user"
  );
  // OpenRouter's Advisor contract says forwarded transcripts must not also
  // replay prior Advisor output items. Doing both currently re-encodes the
  // previous tool result into an SDK-invalid `tool_call_id` message. Preserve
  // branch-aware Persona memory as ordinary, explicitly non-authoritative
  // transcript context when forwarding instead.
  const replay = capabilities.forwardTranscript === false
    ? replayItems.filter(isAdvisorOutputItem)
    : advisorHistoryContext(replayItems);
  const insertionIndex = lastUserIndex >= 0 ? lastUserIndex : converted.length;
  converted.splice(insertionIndex, 0, ...replay);
  converted.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: `[Private Advisor brief]\n${brief}` }],
  });
  return converted;
}

function convertMessage(
  message: OpenRouterMessage,
  index: number,
  capabilities: { allowImages?: boolean; allowFiles?: boolean },
): AdvisorResponsesInputItem[] {
  const content = typeof message.content === "string"
    ? [{ type: textPartType(message.role), text: message.content }]
    : (message.content ?? []).flatMap((part) => convertPart(part, message.role, capabilities));
  if (content.length === 0) return [];
  if (message.role === "assistant") {
    return [{
      type: "message",
      role: "assistant",
      id: `msg_nanthai_context_${index}`,
      status: "completed",
      content,
    }];
  }
  return [{ type: "message", role: message.role, content }];
}

function convertPart(
  part: NonNullable<Exclude<OpenRouterMessage["content"], string>>[number],
  role: OpenRouterMessage["role"],
  capabilities: { allowImages?: boolean; allowFiles?: boolean },
): Record<string, unknown>[] {
  if (part.type === "text" && part.text) {
    return [{ type: textPartType(role), text: part.text }];
  }
  if (capabilities.allowImages !== false && part.type === "image_url" && part.image_url?.url) {
    return [{
      type: "input_image",
      image_url: part.image_url.url,
      detail: part.image_url.detail,
    }];
  }
  if (capabilities.allowFiles !== false && part.type === "file" && part.file?.file_data) {
    return [{
      type: "input_file",
      file_data: part.file.file_data,
      filename: part.file.filename,
    }];
  }
  return [];
}

function textPartType(role: OpenRouterMessage["role"]): "input_text" | "output_text" {
  return role === "assistant" ? "output_text" : "input_text";
}

function isAdvisorOutputItem(value: unknown): value is AdvisorOutputItem {
  return value != null && typeof value === "object" && !Array.isArray(value) &&
    (value as { type?: unknown }).type === "openrouter:advisor";
}

function advisorHistoryContext(replayItems: unknown[]): AdvisorResponsesInputItem[] {
  const advice = replayItems.flatMap((item) => {
    if (!isAdvisorOutputItem(item) || typeof item.advice !== "string") return [];
    const normalized = item.advice.trim();
    return normalized ? [normalized] : [];
  });
  if (advice.length === 0) return [];

  const header = [
    "[Prior private Advisor consultation history]",
    "These are this Persona's earlier successful consultations on the active chat branch.",
    "Use them as context only; the latest user request and current private brief take priority.",
  ].join("\n");
  let text = header;
  for (const [index, item] of advice.entries()) {
    const section = `\n\nPrior consultation ${index + 1}:\n${item}`;
    const remaining = MAX_ADVISOR_HISTORY_BYTES - text.length;
    if (remaining <= 0) break;
    text += section.slice(0, remaining);
  }

  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}
