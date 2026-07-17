import { Id } from "../_generated/dataModel";
import { OpenRouterMessage } from "../lib/openrouter";

/** Minimal message shape needed for context building. */
export interface ContextMessage {
  _id: Id<"messages">;
  chatId: Id<"chats">;
  role: "user" | "assistant" | "system";
  content: string;
  modelId?: string;
  participantId?: Id<"personas">;
  participantName?: string;
  autonomousParticipantId?: string;
  parentMessageIds: Id<"messages">[];
  status: string;
  multiModelGroupId?: string;
  isMultiModelResponse?: boolean;
  imageUrls?: string[];
  documentEvents?: Array<{
    type: "document_created" | "document_updated";
    documentId: string;
    versionId: string;
    storageId: string;
    generatedFileId?: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    title?: string;
    summary?: string;
  }>;
  presentationContext?: {
    projectId: Id<"presentationProjects">;
    projectRevision: number;
    slideId?: string;
    slideRevision?: number;
    elementId?: string;
  };
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
  }>;
  attachments?: Array<{
    type: string;
    url?: string;
    storageId?: string;
    name?: string;
    mimeType?: string;
  }>;
  createdAt: number;
}

export interface BuildRequestMessagesArgs {
  /** All messages in the chat. */
  messages: ContextMessage[];
  /** The assistant message ID being generated (excluded from context). */
  excludeMessageId: Id<"messages">;
  /** System prompt (persona definition). */
  systemPrompt?: string;
  /** Memory context string to inject as second system message. */
  memoryContext?: string;
  /** Volatile date/time context for search or calendar-like tool turns. */
  dateContext?: string;
  /** Whether to expand multi-model groups (true for chat mode, false for autonomous). */
  expandMultiModelGroups?: boolean;
  /** Max tokens for context window. Default: 75000. */
  maxContextTokens?: number;
}

export type ContextAttachment = NonNullable<ContextMessage["attachments"]>[number];

export type MemoryContextItem = {
  content: string;
  isPinned: boolean;
};

export type RequestMessage = OpenRouterMessage;
