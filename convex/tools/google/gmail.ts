"use node";

// convex/tools/google/gmail.ts
// =============================================================================
// Gmail tools implemented via Manual Gmail (IMAP/SMTP app password).
//
// Tool names intentionally stay the same as the former Gmail REST API tools so
// existing skills, chats, and tool rendering keep working.
// =============================================================================

import { createTool } from "../registry";
import {
  getGmailManualCredentials,
  listGmailManualLabels,
  listGmailManualMessages,
  modifyGmailManualLabels,
  trashGmailManualMessages,
} from "./gmail_manual_client";

export { gmailCreateDraft, gmailSend } from "./gmail_mail";

function gmailManualToolError(error: unknown) {
  return {
    success: false,
    data: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

function summarizeBatch(
  results: Array<{ id: string; success: boolean; error?: string }>,
  successMessage: (count: number) => string,
) {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);
  if (failed.length === 0) {
    return {
      success: true,
      data: {
        updatedCount: succeeded,
        message: successMessage(succeeded),
      },
    };
  }
  return {
    success: succeeded > 0,
    data: {
      updatedCount: succeeded,
      failedCount: failed.length,
      failures: failed.map((f) => ({ id: f.id, error: f.error })),
      message:
        succeeded > 0
          ? `${succeeded} email(s) updated, ${failed.length} failed.`
          : `Failed to update ${failed.length} email(s).`,
    },
    error: succeeded === 0 ? `All ${failed.length} operation(s) failed.` : undefined,
  };
}

export const gmailRead = createTool({
  name: "gmail_read",
  description:
    "Read recent emails from the user's manually connected Gmail inbox. " +
    "Returns subject, sender, date, and snippet/body for each email. " +
    "Search supports a practical subset of Gmail syntax such as from:, to:, subject:, after:, before:, is:unread, is:read, and is:starred.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional Gmail-style search query." },
      max_results: { type: "number", description: "Maximum number of emails to return (default 10, max 20)." },
      include_body: { type: "boolean", description: "Whether to include body text." },
    },
    required: [],
  },
  execute: async (toolCtx, args) => {
    try {
      const credentials = await getGmailManualCredentials(toolCtx.ctx, toolCtx.userId);
      const maxResults = Math.min((args.max_results as number) || 10, 20);
      const messages = await listGmailManualMessages(credentials, {
        query: (args.query as string) || "",
        maxResults,
        includeBody: (args.include_body as boolean) ?? false,
      });
      return {
        success: true,
        data: {
          messages,
          resultCount: messages.length,
          message: `Found ${messages.length} email(s).`,
        },
      };
    } catch (error) {
      return gmailManualToolError(error);
    }
  },
});

export const gmailSearch = createTool({
  name: "gmail_search",
  description:
    "Search the user's manually connected Gmail account. " +
    "Supports a practical subset of Gmail query syntax: from:, to:, subject:, after:, before:, is:unread, is:read, is:starred, plus free-text body search.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail-style search query." },
      max_results: { type: "number", description: "Maximum results (default 10, max 20)." },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    return gmailRead.execute(toolCtx, {
      query: args.query,
      max_results: args.max_results || 10,
      include_body: false,
    });
  },
});

export const gmailDelete = createTool({
  name: "gmail_delete",
  description:
    "Move one or more Gmail messages to Trash. Requires message IDs returned by gmail_read or gmail_search.",
  parameters: {
    type: "object",
    properties: {
      message_ids: {
        type: "array",
        description: "Array of Gmail message IDs.",
        items: { type: "string" },
      },
    },
    required: ["message_ids"],
  },
  execute: async (toolCtx, args) => {
    const messageIds = args.message_ids as string[];
    if (!messageIds || messageIds.length === 0) {
      return { success: false, data: null, error: "Missing required field: 'message_ids'." };
    }

    try {
      const credentials = await getGmailManualCredentials(toolCtx.ctx, toolCtx.userId);
      const results = await trashGmailManualMessages(credentials, messageIds);
      const summarized = summarizeBatch(results, (count) => `${count} email(s) moved to Trash.`);
      return {
        ...summarized,
        data: summarized.data
          ? {
              ...summarized.data,
              trashedCount: (summarized.data as { updatedCount: number }).updatedCount,
            }
          : summarized.data,
      };
    } catch (error) {
      return gmailManualToolError(error);
    }
  },
});

export const gmailModifyLabels = createTool({
  name: "gmail_modify_labels",
  description:
    "Modify Gmail labels/flags. Common operations: archive by removing INBOX, mark read by removing UNREAD, mark unread by adding UNREAD, star by adding STARRED, unstar by removing STARRED, trash by adding TRASH.",
  parameters: {
    type: "object",
    properties: {
      message_ids: {
        type: "array",
        description: "Array of Gmail message IDs.",
        items: { type: "string" },
      },
      add_labels: {
        type: "array",
        description: "Label IDs/names to add.",
        items: { type: "string" },
      },
      remove_labels: {
        type: "array",
        description: "Label IDs/names to remove.",
        items: { type: "string" },
      },
    },
    required: ["message_ids"],
  },
  execute: async (toolCtx, args) => {
    const messageIds = args.message_ids as string[];
    const addLabels = (args.add_labels as string[]) || [];
    const removeLabels = (args.remove_labels as string[]) || [];
    if (!messageIds || messageIds.length === 0) {
      return { success: false, data: null, error: "Missing required field: 'message_ids'." };
    }
    if (addLabels.length === 0 && removeLabels.length === 0) {
      return { success: false, data: null, error: "At least one of 'add_labels' or 'remove_labels' must be provided." };
    }

    try {
      const credentials = await getGmailManualCredentials(toolCtx.ctx, toolCtx.userId);
      const results = await modifyGmailManualLabels(credentials, messageIds, addLabels, removeLabels);
      return summarizeBatch(results, (count) => `${count} email(s) updated.`);
    } catch (error) {
      return gmailManualToolError(error);
    }
  },
});

export const gmailListLabels = createTool({
  name: "gmail_list_labels",
  description:
    "List Gmail labels/folders available through the user's Manual Gmail IMAP connection.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (toolCtx) => {
    try {
      const credentials = await getGmailManualCredentials(toolCtx.ctx, toolCtx.userId);
      const labels = await listGmailManualLabels(credentials);
      return {
        success: true,
        data: {
          labels,
          resultCount: labels.length,
          message: `Found ${labels.length} Gmail label(s).`,
        },
      };
    } catch (error) {
      return gmailManualToolError(error);
    }
  },
});
