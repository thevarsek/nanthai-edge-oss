// convex/chat/helpers.ts
// =============================================================================
// Server-side context building for OpenRouter requests.
//
// Mirrors the iOS ChatService+RequestMessages.swift pipeline:
// 1. Walk parent chain to find active branch path
// 2. Expand multi-model groups (chat mode) or use selected only (ideascape)
// 3. Build OpenRouterChatMessage array with system prompt + memory context
// 4. Consolidate consecutive same-role messages (Anthropic requirement)
// 5. Truncate to token budget
// =============================================================================

import { ContentPart, OpenRouterMessage } from "../lib/openrouter";
import { BuildRequestMessagesArgs, ContextMessage } from "./helpers_types";
import {
  resolveAllowedImageMessageIds,
  splitMessageAttachmentParts,
} from "./helpers_attachment_utils";
import {
  branchPathIds,
  consolidateConsecutiveRoles,
  contentFromParts,
  sanitizeOpenRouterMessageName,
  truncateMessages,
} from "./helpers_utils";

export function buildCurrentDatePrompt(now: Date = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  return `Today is ${date}. Current date/time: ${now.toISOString()} (UTC). Use this to resolve relative dates such as today, yesterday, last week, and this week.`;
}

// -- Main entry point ---------------------------------------------------------

/**
 * Build the OpenRouter request messages for a generation call.
 *
 * This is the server-side equivalent of iOS's
 * `ChatService.buildRequestMessages()` + `messagesForParticipant()`.
 */
export function buildRequestMessages(
  args: BuildRequestMessagesArgs,
): OpenRouterMessage[] {
  const {
    messages,
    excludeMessageId,
    systemPrompt,
    memoryContext,
    dateContext,
    expandMultiModelGroups = true,
    maxContextTokens = 75_000,
  } = args;

  const messagesById = new Map(messages.map((msg) => [msg._id, msg]));

  // Find the branch path: walk backward from the excluded message's parent chain.
  // The excluded message is the assistant message being generated, so we walk
  // from its parents to find all context messages.
  const excludedMsg = messagesById.get(excludeMessageId);
  if (!excludedMsg) return [];

  const pathIds = branchPathIds(excludeMessageId, messagesById);
  pathIds.delete(excludeMessageId);

  let branchMessages = messages.filter((m) => pathIds.has(m._id));

  // Expand multi-model groups: include all siblings of any group on the path.
  if (expandMultiModelGroups) {
    const groupIds = new Set<string>();
    for (const m of branchMessages) {
      if (m.multiModelGroupId && m.isMultiModelResponse) {
        groupIds.add(m.multiModelGroupId);
      }
    }
    if (groupIds.size > 0) {
      const siblings = messages.filter(
        (m) =>
          m.multiModelGroupId &&
          groupIds.has(m.multiModelGroupId) &&
          !pathIds.has(m._id),
      );
      branchMessages = [...branchMessages, ...siblings];
    }
  }

  branchMessages.sort((a, b) => a.createdAt - b.createdAt);
  const allowedAssistantImageMessageIds = resolveAllowedImageMessageIds(
    branchMessages,
  );

  const result: OpenRouterMessage[] = [];
  let pendingAssistantImageParts: ContentPart[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  if (dateContext) {
    result.push({ role: "system", content: dateContext });
  }

  if (memoryContext) {
    result.push({ role: "system", content: memoryContext });
  }

  for (const msg of branchMessages) {
    if (msg.role === "system") continue;
    if (msg.status === "failed" || msg.status === "cancelled") continue;

    const content = msg.content.trim();
    const { imageParts, nonImageParts } = splitMessageAttachmentParts(msg);
    const parts: ContentPart[] = [];

    if (msg.role === "assistant") {
      if (
        imageParts.length > 0 &&
        allowedAssistantImageMessageIds.has(msg._id)
      ) {
        // Keep generated assistant images pending until the next user turn.
        // This aligns image-editing context with the user's follow-up prompt.
        pendingAssistantImageParts.push(...imageParts);
      }

      const assistantText = imageParts.length > 0 ? "[Generated image]" : content;
      if (assistantText.length > 0) {
        parts.push({ type: "text", text: assistantText });
      }
      const documentContext = generatedDocumentContext(msg);
      if (documentContext) {
        parts.push({ type: "text", text: documentContext });
      }
      parts.push(...nonImageParts);
    } else {
      if (content.length > 0) {
        parts.push({ type: "text", text: content });
      }
      parts.push(...nonImageParts);
      parts.push(...imageParts);
      if (pendingAssistantImageParts.length > 0) {
        parts.push(...pendingAssistantImageParts);
        pendingAssistantImageParts = [];
      }
    }

    if (parts.length === 0) continue;

    const orMsg: OpenRouterMessage = {
      role: msg.role,
      content: contentFromParts(parts),
    };

    const sanitizedName = sanitizeOpenRouterMessageName(msg.participantName);
    if (sanitizedName) {
      orMsg.name = sanitizedName;
    }

    result.push(orMsg);
  }

  const consolidated = consolidateConsecutiveRoles(result);
  return truncateMessages(consolidated, maxContextTokens);
}

function generatedDocumentContext(msg: {
  documentEvents?: ContextMessage["documentEvents"];
}): string | undefined {
  const events = msg.documentEvents?.filter((event) =>
    event.documentId &&
    event.versionId &&
    event.storageId &&
    event.filename
  );
  if (!events || events.length === 0) return undefined;

  const lines = events.map((event) => {
    const action = event.type === "document_updated" ? "Updated" : "Created";
    const title = event.title?.trim() ? `, title "${event.title.trim()}"` : "";
    const summary = event.summary?.trim() ? `, summary "${event.summary.trim()}"` : "";
    const generatedFileId = event.generatedFileId ? `, generatedFileId ${event.generatedFileId}` : "";
    return `- ${action} document "${event.filename}"${title} (${event.mimeType}), documentId ${event.documentId}, versionId ${event.versionId}, storageId ${event.storageId}${generatedFileId}${summary}.`;
  });

  return [
    "[Hidden document context from prior assistant output]",
    ...lines,
    "If the user asks to inspect, revise, summarize, or reuse one of these documents, use the document/read tools with these IDs rather than guessing from chat text.",
  ].join("\n");
}

/**
 * Format memory context string for injection into the system prompt area.
 * Mirrors iOS MemoryService.formatMemoryContext().
 */
export function formatMemoryContext(
  memories: Array<{
    content: string;
    isPinned: boolean;
    memoryType?: string;
    category?: string;
    retrievalMode?: string;
    importanceScore?: number;
  }>,
): string | undefined {
  if (memories.length === 0) return undefined;

  const preferenceLines = memories
    .filter(
      (memory) =>
        memory.retrievalMode === "alwaysOn" ||
        memory.memoryType === "responsePreference" ||
        memory.category === "writingStyle",
    )
    .map((memory) => {
      const pin = memory.isPinned ? " [pinned]" : "";
      return `- ${memory.content}${pin}`;
    });

  const profileLines = memories
    .filter(
      (memory) =>
        memory.category === "identity" ||
        memory.category === "background" ||
        memory.category === "relationships" ||
        memory.category === "skills" ||
        memory.memoryType === "profile",
    )
    .map((memory) => {
      const pin = memory.isPinned ? " [pinned]" : "";
      return `- ${memory.content}${pin}`;
    });

  const contextLines = memories
    .filter(
      (memory) =>
        memory.category !== "writingStyle" &&
        memory.category !== "identity" &&
        memory.category !== "background" &&
        memory.category !== "relationships" &&
        memory.category !== "skills" &&
        memory.memoryType !== "responsePreference" &&
        memory.memoryType !== "profile",
    )
    .map((memory) => {
      const pin = memory.isPinned ? " [pinned]" : "";
      return `- ${memory.content}${pin}`;
    });

  const sections: string[] = [];
  if (preferenceLines.length > 0) {
    sections.push("Response preferences:");
    sections.push(...preferenceLines);
    sections.push("");
  }
  if (profileLines.length > 0) {
    sections.push("User profile:");
    sections.push(...profileLines);
    sections.push("");
  }
  if (contextLines.length > 0) {
    sections.push("Relevant context:");
    sections.push(...contextLines);
    sections.push("");
  }

  return [
    "You have the following knowledge about the user from previous conversations:",
    ...sections,
    "",
    "Use this context naturally when relevant. Do not explicitly mention that you have memories unless asked.",
  ].join("\n");
}
