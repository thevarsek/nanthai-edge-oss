import { ContentPart, OpenRouterMessage } from "../lib/openrouter";
import { ContextMessage } from "./helpers_types";

/**
 * Walk backward from a message through parentMessageIds to the root,
 * collecting all ancestor message IDs. Returns the set of IDs on the path.
 */
export function branchPathIds(
  fromId: string,
  messagesById: Map<string, ContextMessage>,
): Set<string> {
  const pathIds = new Set<string>();
  const stack: string[] = [fromId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId) continue;
    if (pathIds.has(currentId)) continue;
    pathIds.add(currentId);

    const msg = messagesById.get(currentId);
    if (!msg) continue;

    for (const parentId of msg.parentMessageIds) {
      if (!pathIds.has(parentId)) {
        stack.push(parentId);
      }
    }
  }

  return pathIds;
}

/**
 * Merge consecutive messages with the same role into a single message.
 * Required for Anthropic models that enforce strict user/assistant alternation.
 * System messages are never consolidated.
 */
export function consolidateConsecutiveRoles(
  messages: OpenRouterMessage[],
): OpenRouterMessage[] {
  if (messages.length <= 1) return messages;

  const consolidated: OpenRouterMessage[] = [];
  let run: OpenRouterMessage[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      consolidated.push(run[0]);
      run = [];
      return;
    }

    const first = run[0];
    const firstName = first.name;
    const textSegments: string[] = [];
    const nonTextParts: ContentPart[] = [];

    for (const message of run) {
      const parts = contentToParts(message.content);
      const hasDifferentName =
        message.name && firstName && message.name !== firstName;
      const prefix = hasDifferentName ? `[${message.name}]: ` : "";

      const messageText = parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (messageText.length > 0) {
        textSegments.push(`${prefix}${messageText}`);
      } else if (prefix.length > 0) {
        textSegments.push(prefix.trim());
      }

      for (const part of parts) {
        if (part.type !== "text") {
          nonTextParts.push(part);
        }
      }
    }

    const joinedText = textSegments.join("\n\n").trim();
    const mergedParts: ContentPart[] = [];

    if (joinedText.length > 0) {
      mergedParts.push({ type: "text", text: joinedText });
    }
    mergedParts.push(...nonTextParts);

    if (mergedParts.length > 0) {
      consolidated.push({
        role: first.role,
        content: contentFromParts(mergedParts),
        name: first.name,
      });
    }

    run = [];
  };

  for (const msg of messages) {
    if (msg.role === "system") {
      flushRun();
      consolidated.push(msg);
      continue;
    }

    if (run.length === 0) {
      run = [msg];
      continue;
    }

    if (run[0].role === msg.role) {
      run.push(msg);
    } else {
      flushRun();
      run = [msg];
    }
  }

  flushRun();
  return consolidated;
}

/**
 * Truncate messages to fit within a token budget.
 * Keeps the most recent messages, always preserving system messages.
 */
export function truncateMessages(
  messages: OpenRouterMessage[],
  maxTokens: number,
): OpenRouterMessage[] {
  if (messages.length === 0) return [];

  const messageCosts = messages.map((msg) => {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : (msg.content ?? []).map((p) => p.text ?? "").join("");
    return { msg, cost: estimateTokens(text) };
  });

  const totalTokens = messageCosts.reduce((sum, mc) => sum + mc.cost, 0);
  if (totalTokens <= maxTokens) return messages;

  const reversed = [...messageCosts].reverse();
  const kept: OpenRouterMessage[] = [];
  let runningTotal = 0;

  for (const { msg, cost } of reversed) {
    if (runningTotal + cost > maxTokens) {
      if (kept.length === 0) {
        kept.push(msg);
      }
      continue;
    }
    kept.push(msg);
    runningTotal += cost;
  }

  let trimmed = kept.reverse();

  const hasSystem = trimmed.some((m) => m.role === "system");
  if (!hasSystem) {
    const latestSystem = messages.findLast((message: OpenRouterMessage) => message.role === "system");
    if (latestSystem) {
      trimmed = [latestSystem, ...trimmed];
    }
  }

  return trimmed;
}

export function sanitizeOpenRouterMessageName(name?: string): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;

  // OpenRouter/OpenAI name field accepts only [A-Za-z0-9_-] up to 64 chars.
  const normalized = trimmed
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) return undefined;
  return normalized.slice(0, 64);
}

export function contentFromParts(parts: ContentPart[]): OpenRouterMessage["content"] {
  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text ?? "";
  }
  return parts;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function contentToParts(content: OpenRouterMessage["content"]): ContentPart[] {
  if (typeof content === "string") {
    return content.trim().length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content ?? [];
}
