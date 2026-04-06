// convex/tools/microsoft/outlook.ts
// =============================================================================
// Outlook Mail tools: send, read, search, and delete emails via Microsoft Graph.
//
// Uses raw `fetch` against https://graph.microsoft.com/v1.0 — no Node.js SDK.
// Tokens are obtained via `getMicrosoftAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getMicrosoftAccessToken } from "./auth";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

// ---------------------------------------------------------------------------
// outlook_send — Send an email via Outlook
// ---------------------------------------------------------------------------

export const outlookSend = createTool({
  name: "outlook_send",
  description:
    "Send an email via the user's connected Microsoft Outlook account. " +
    "Use when the user asks you to send an email, reply to someone, or draft and send a message " +
    "through their Microsoft/Outlook account. " +
    "The email is sent immediately from the user's Outlook address. " +
    "Supports plain text and HTML bodies. For CC/BCC, include them in the appropriate fields.",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email address (e.g. 'user@example.com').",
      },
      subject: {
        type: "string",
        description: "Email subject line.",
      },
      body: {
        type: "string",
        description: "Email body content (plain text or HTML).",
      },
      is_html: {
        type: "boolean",
        description:
          "Whether the body is HTML (default: false for plain text).",
      },
      cc: {
        type: "string",
        description:
          "CC recipient email address (optional). For multiple, comma-separate.",
      },
      bcc: {
        type: "string",
        description:
          "BCC recipient email address (optional). For multiple, comma-separate.",
      },
    },
    required: ["to", "subject", "body"],
  },

  execute: async (toolCtx, args) => {
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;
    const isHtml = (args.is_html as boolean) ?? false;
    const cc = args.cc as string | undefined;
    const bcc = args.bcc as string | undefined;

    if (!to || !subject) {
      return { success: false, data: null, error: "Missing 'to' or 'subject'" };
    }

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // Build Microsoft Graph sendMail payload
      const toRecipients = to.split(",").map((email) => ({
        emailAddress: { address: email.trim() },
      }));

      const message: Record<string, unknown> = {
        subject,
        body: {
          contentType: isHtml ? "HTML" : "Text",
          content: body,
        },
        toRecipients,
      };

      if (cc) {
        message.ccRecipients = cc.split(",").map((email) => ({
          emailAddress: { address: email.trim() },
        }));
      }

      if (bcc) {
        message.bccRecipients = bcc.split(",").map((email) => ({
          emailAddress: { address: email.trim() },
        }));
      }

      const response = await fetch(`${GRAPH_API}/sendMail`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });

      // Microsoft returns 202 Accepted on successful send
      if (!response.ok && response.status !== 202) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Outlook send failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        data: {
          message: `Email sent successfully to ${to} with subject "${subject}".`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// outlook_read — Read recent emails from Outlook
// ---------------------------------------------------------------------------

export const outlookRead = createTool({
  name: "outlook_read",
  description:
    "Read recent emails from the user's Microsoft Outlook inbox. " +
    "Returns subject, sender, date, and preview for each email. " +
    "Use when the user asks to check their Outlook email, see recent messages, " +
    "or wants you to read their inbox. " +
    "Optionally filter by folder or use OData query syntax.",
  parameters: {
    type: "object",
    properties: {
      folder: {
        type: "string",
        description:
          "Mail folder to read from (optional). " +
          "Common values: 'inbox' (default), 'sentitems', 'drafts', 'deleteditems', 'archive'.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of emails to return (default 10, max 20).",
      },
      include_body: {
        type: "boolean",
        description:
          "Whether to include the full email body text (default: false, only preview).",
      },
      filter: {
        type: "string",
        description:
          "OData $filter expression (optional). " +
          "Examples: \"isRead eq false\", \"from/emailAddress/address eq 'boss@company.com'\", " +
          "\"receivedDateTime ge 2026-01-01T00:00:00Z\".",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const folder = (args.folder as string) || "inbox";
    const maxResults = Math.min((args.max_results as number) || 10, 20);
    const includeBody = (args.include_body as boolean) ?? false;
    const filter = args.filter as string | undefined;

    try {
      console.log(
        `outlook_read: folder="${folder}", maxResults=${maxResults}, includeBody=${includeBody}`,
      );

      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // Build query parameters
      const select = includeBody
        ? "id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead,conversationId"
        : "id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,conversationId";

      const params = new URLSearchParams({
        $top: String(maxResults),
        $select: select,
        $orderby: "receivedDateTime desc",
      });
      if (filter) params.set("$filter", filter);

      const response = await fetch(
        `${GRAPH_API}/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Outlook read failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        value?: Array<{
          id: string;
          subject?: string;
          from?: {
            emailAddress?: { name?: string; address?: string };
          };
          toRecipients?: Array<{
            emailAddress?: { name?: string; address?: string };
          }>;
          receivedDateTime?: string;
          bodyPreview?: string;
          body?: { contentType?: string; content?: string };
          isRead?: boolean;
          conversationId?: string;
        }>;
        "@odata.nextLink"?: string;
      };

      if (!data.value || data.value.length === 0) {
        return {
          success: true,
          data: {
            messages: [],
            resultCount: 0,
            message: `No emails found in ${folder}.`,
          },
        };
      }

      const messages = data.value.map((m) => {
        const result: Record<string, unknown> = {
          id: m.id,
          subject: m.subject || "(no subject)",
          from: m.from?.emailAddress?.address || "unknown",
          fromName: m.from?.emailAddress?.name,
          to: m.toRecipients
            ?.map((r) => r.emailAddress?.address)
            .filter(Boolean)
            .join(", "),
          date: m.receivedDateTime,
          preview: m.bodyPreview,
          isUnread: m.isRead === false,
          conversationId: m.conversationId,
        };

        if (includeBody && m.body?.content) {
          // Strip HTML tags for a rough plain text version if HTML
          if (m.body.contentType === "html") {
            result.body = m.body.content
              .replace(/<[^>]*>/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 10_000);
          } else {
            result.body = m.body.content.slice(0, 10_000);
          }
        }

        return result;
      });

      return {
        success: true,
        data: {
          messages,
          resultCount: messages.length,
          hasMore: !!data["@odata.nextLink"],
          message: `Found ${messages.length} email(s) in ${folder}.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// outlook_search — Search emails in Outlook
// ---------------------------------------------------------------------------

export const outlookSearch = createTool({
  name: "outlook_search",
  description:
    "Search the user's Outlook emails using Microsoft Graph search. " +
    "Use when the user asks to find specific emails, search for messages from a person, " +
    "look for emails about a topic, or find emails within a date range. " +
    "Uses OData $search for keyword queries and $filter for structured filtering. " +
    "Examples: search 'invoice' to find emails containing 'invoice', " +
    "or filter \"from/emailAddress/address eq 'alice@example.com'\".",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search keyword query (required). Searches subject, body, and other fields. " +
          "Examples: 'quarterly report', 'from:alice', 'invoice 2026'.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results (default 10, max 20).",
      },
    },
    required: ["query"],
  },

  execute: async (toolCtx, args) => {
    const query = args.query as string;
    const maxResults = Math.min((args.max_results as number) || 10, 20);

    if (!query) {
      return {
        success: false,
        data: null,
        error: "Missing required 'query' parameter.",
      };
    }

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const params = new URLSearchParams({
        $search: `"${query}"`,
        $top: String(maxResults),
        $select:
          "id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead",
        $orderby: "receivedDateTime desc",
      });

      const response = await fetch(
        `${GRAPH_API}/messages?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            // ConsistencyLevel header needed for $search
            ConsistencyLevel: "eventual",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Outlook search failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        value?: Array<{
          id: string;
          subject?: string;
          from?: {
            emailAddress?: { name?: string; address?: string };
          };
          toRecipients?: Array<{
            emailAddress?: { name?: string; address?: string };
          }>;
          receivedDateTime?: string;
          bodyPreview?: string;
          isRead?: boolean;
        }>;
      };

      if (!data.value || data.value.length === 0) {
        return {
          success: true,
          data: {
            messages: [],
            resultCount: 0,
            message: `No emails found matching "${query}".`,
          },
        };
      }

      const messages = data.value.map((m) => ({
        id: m.id,
        subject: m.subject || "(no subject)",
        from: m.from?.emailAddress?.address || "unknown",
        fromName: m.from?.emailAddress?.name,
        to: m.toRecipients
          ?.map((r) => r.emailAddress?.address)
          .filter(Boolean)
          .join(", "),
        date: m.receivedDateTime,
        preview: m.bodyPreview,
        isUnread: m.isRead === false,
      }));

      return {
        success: true,
        data: {
          messages,
          resultCount: messages.length,
          message: `Found ${messages.length} email(s) matching "${query}".`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// outlook_delete — Move emails to Deleted Items
// ---------------------------------------------------------------------------

export const outlookDelete = createTool({
  name: "outlook_delete",
  description:
    "Move one or more emails to the Deleted Items folder in the user's Outlook. " +
    "Use when the user asks to delete, remove, or trash emails. " +
    "Requires message IDs, which you can get from outlook_read or outlook_search results.",
  parameters: {
    type: "object",
    properties: {
      message_ids: {
        type: "array",
        description:
          "Array of Outlook message IDs to delete. " +
          "Get these from the 'id' field in outlook_read or outlook_search results.",
        items: { type: "string" },
      },
    },
    required: ["message_ids"],
  },

  execute: async (toolCtx, args) => {
    const messageIds = args.message_ids as string[];

    if (!messageIds || messageIds.length === 0) {
      return {
        success: false,
        data: null,
        error:
          "Missing required field: 'message_ids' (must be a non-empty array).",
      };
    }

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const results = await Promise.all(
        messageIds.map(async (id) => {
          try {
            // Microsoft Graph DELETE /me/messages/{id} moves to Deleted Items
            const response = await fetch(
              `${GRAPH_API}/messages/${encodeURIComponent(id)}`,
              {
                method: "DELETE",
                headers: { Authorization: `Bearer ${accessToken}` },
              },
            );

            // 204 No Content = success
            if (response.status === 204 || response.ok) {
              return { id, success: true };
            }

            const errorText = await response.text();
            return {
              id,
              success: false,
              error: `HTTP ${response.status}: ${errorText}`,
            };
          } catch (e) {
            return {
              id,
              success: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);

      if (failed.length === 0) {
        return {
          success: true,
          data: {
            deletedCount: succeeded,
            message: `${succeeded} email(s) deleted.`,
          },
        };
      }

      return {
        success: succeeded > 0,
        data: {
          deletedCount: succeeded,
          failedCount: failed.length,
          failures: failed.map((f) => ({ id: f.id, error: f.error })),
          message:
            succeeded > 0
              ? `${succeeded} email(s) deleted, ${failed.length} failed.`
              : `Failed to delete ${failed.length} email(s).`,
        },
        error:
          succeeded === 0
            ? `All ${failed.length} delete(s) failed.`
            : undefined,
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// outlook_move — Move emails to a different folder
// ---------------------------------------------------------------------------

export const outlookMove = createTool({
  name: "outlook_move",
  description:
    "Move one or more emails to a different mail folder in the user's Outlook. " +
    "Use when the user asks to move emails to a folder, organize their inbox, " +
    "archive messages, or file emails into specific folders. " +
    "Requires message IDs (from outlook_read or outlook_search) and a destination folder. " +
    "You can use well-known folder names ('inbox', 'archive', 'drafts', 'sentitems', " +
    "'deleteditems', 'junkemail') or a folder ID from outlook_list_folders.",
  parameters: {
    type: "object",
    properties: {
      message_ids: {
        type: "array",
        description:
          "Array of Outlook message IDs to move. " +
          "Get these from the 'id' field in outlook_read or outlook_search results.",
        items: { type: "string" },
      },
      destination_folder: {
        type: "string",
        description:
          "Destination folder. Use well-known names ('inbox', 'archive', 'drafts', " +
          "'sentitems', 'deleteditems', 'junkemail') or a folder ID from outlook_list_folders.",
      },
    },
    required: ["message_ids", "destination_folder"],
  },

  execute: async (toolCtx, args) => {
    const messageIds = args.message_ids as string[];
    const destinationFolder = args.destination_folder as string;

    if (!messageIds || messageIds.length === 0) {
      return {
        success: false,
        data: null,
        error: "Missing required field: 'message_ids' (must be a non-empty array).",
      };
    }

    if (!destinationFolder) {
      return {
        success: false,
        data: null,
        error: "Missing required field: 'destination_folder'.",
      };
    }

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const results = await Promise.all(
        messageIds.map(async (id) => {
          try {
            // POST /me/messages/{id}/move
            const response = await fetch(
              `${GRAPH_API}/messages/${encodeURIComponent(id)}/move`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ destinationId: destinationFolder }),
              },
            );

            if (response.ok) {
              const moved = (await response.json()) as { id: string };
              return { id, success: true, newId: moved.id };
            }

            const errorText = await response.text();
            return {
              id,
              success: false,
              error: `HTTP ${response.status}: ${errorText}`,
            };
          } catch (e) {
            return {
              id,
              success: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);

      if (failed.length === 0) {
        return {
          success: true,
          data: {
            movedCount: succeeded,
            destinationFolder,
            message: `${succeeded} email(s) moved to "${destinationFolder}".`,
          },
        };
      }

      return {
        success: succeeded > 0,
        data: {
          movedCount: succeeded,
          failedCount: failed.length,
          failures: failed.map((f) => ({ id: f.id, error: f.error })),
          message:
            succeeded > 0
              ? `${succeeded} email(s) moved, ${failed.length} failed.`
              : `Failed to move ${failed.length} email(s).`,
        },
        error:
          succeeded === 0
            ? `All ${failed.length} move(s) failed.`
            : undefined,
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// outlook_list_folders — List mail folders (needed for move operations)
// ---------------------------------------------------------------------------

export const outlookListFolders = createTool({
  name: "outlook_list_folders",
  description:
    "List all mail folders in the user's Outlook account. " +
    "Use this to discover folder IDs for use with outlook_move. " +
    "Returns both well-known folders (Inbox, Sent Items, Drafts, etc.) " +
    "and user-created folders. Each folder has an 'id' (use this for move " +
    "operations) and a 'displayName' (human-readable).",
  parameters: {
    type: "object",
    properties: {
      parent_folder_id: {
        type: "string",
        description:
          "Parent folder ID to list child folders of (optional). " +
          "Omit to list top-level folders.",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const parentFolderId = args.parent_folder_id as string | undefined;

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      let url: string;
      if (parentFolderId) {
        url = `${GRAPH_API}/mailFolders/${encodeURIComponent(parentFolderId)}/childFolders?$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount`;
      } else {
        url = `${GRAPH_API}/mailFolders?$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount&$top=50`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Outlook list folders failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        value?: Array<{
          id: string;
          displayName: string;
          totalItemCount?: number;
          unreadItemCount?: number;
          childFolderCount?: number;
        }>;
      };

      const folders = (data.value || []).map((f) => ({
        id: f.id,
        displayName: f.displayName,
        totalItems: f.totalItemCount,
        unreadItems: f.unreadItemCount,
        hasSubfolders: (f.childFolderCount ?? 0) > 0,
      }));

      return {
        success: true,
        data: {
          folders,
          folderCount: folders.length,
          message: `Found ${folders.length} mail folder(s).`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
