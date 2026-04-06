// convex/tools/google/gmail.ts
// =============================================================================
// Gmail tools: send, read, and search emails via the Gmail REST API.
//
// Uses raw `fetch` against https://gmail.googleapis.com — no Node.js SDK.
// Tokens are obtained via `getGoogleAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getGoogleAccessToken, googleCapabilityToolError } from "./auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function encodeBase64UrlUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// gmail_send — Send an email
// ---------------------------------------------------------------------------

export const gmailSend = createTool({
  name: "gmail_send",
  description:
    "Send an email via the user's connected Gmail account. " +
    "Use when the user asks you to send an email, reply to someone, or draft and send a message. " +
    "The email is sent immediately from the user's Gmail address. " +
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
      const { accessToken, connection } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "gmail",
      );

      // Build RFC 2822 email message
      const headers: string[] = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: ${isHtml ? "text/html" : "text/plain"}; charset=utf-8`,
      ];
      if (cc) headers.push(`Cc: ${cc}`);
      if (bcc) headers.push(`Bcc: ${bcc}`);
      if (connection.email) headers.push(`From: ${connection.email}`);

      const rawMessage = headers.join("\r\n") + "\r\n\r\n" + body;

      // Gmail expects the raw message base64url-encoded as UTF-8 bytes.
      const encoded = encodeBase64UrlUtf8(rawMessage);

      const response = await fetch(`${GMAIL_API}/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Gmail send failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        id: string;
        threadId: string;
        labelIds: string[];
      };

      return {
        success: true,
        data: {
          messageId: result.id,
          threadId: result.threadId,
          message: `Email sent successfully to ${to} with subject "${subject}".`,
        },
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// gmail_read — Read recent emails
// ---------------------------------------------------------------------------

export const gmailRead = createTool({
  name: "gmail_read",
  description:
    "Read recent emails from the user's Gmail inbox. " +
    "Returns subject, sender, date, and snippet for each email. " +
    "Use when the user asks to check their email, see recent messages, " +
    "or wants you to read their inbox. " +
    "Optionally provide a Gmail search query to filter results.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Gmail search query (optional). Same syntax as the Gmail search bar. " +
          "Examples: 'from:boss@company.com', 'is:unread', 'subject:invoice', " +
          "'after:2026/01/01 before:2026/02/01'.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of emails to return (default 10, max 20).",
      },
      include_body: {
        type: "boolean",
        description:
          "Whether to include the full email body text (default: false, only snippets).",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const query = (args.query as string) || "";
    const maxResults = Math.min((args.max_results as number) || 10, 20);
    const includeBody = (args.include_body as boolean) ?? false;

    try {
      console.log(`gmail_read: query="${query}", maxResults=${maxResults}, includeBody=${includeBody}`);

      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "gmail",
      );

      // List message IDs
      const listParams = new URLSearchParams({
        maxResults: String(maxResults),
      });
      if (query) listParams.set("q", query);

      const listResponse = await fetch(
        `${GMAIL_API}/messages?${listParams.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!listResponse.ok) {
        const errorText = await listResponse.text();
        return {
          success: false,
          data: null,
          error: `Gmail list failed (HTTP ${listResponse.status}): ${errorText}`,
        };
      }

      const listData = (await listResponse.json()) as {
        messages?: Array<{ id: string; threadId: string }>;
        resultSizeEstimate: number;
      };

      if (!listData.messages || listData.messages.length === 0) {
        return {
          success: true,
          data: {
            messages: [],
            resultCount: 0,
            message: query
              ? `No emails found matching "${query}".`
              : "Inbox is empty.",
          },
        };
      }

      // Fetch each message's metadata (in parallel)
      const format = includeBody ? "full" : "metadata";
      const messages = await Promise.all(
        listData.messages.map(async (m) => {
          try {
            // Gmail API requires metadataHeaders as repeated query params
            const msgParams = new URLSearchParams({ format });
            if (!includeBody) {
              for (const h of ["Subject", "From", "Date", "To"]) {
                msgParams.append("metadataHeaders", h);
              }
            }
            const msgResponse = await fetch(
              `${GMAIL_API}/messages/${m.id}?${msgParams.toString()}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (!msgResponse.ok) return null;

            const msg = (await msgResponse.json()) as {
              id: string;
              threadId: string;
              snippet: string;
              internalDate: string;
              labelIds?: string[];
              payload?: {
                headers?: Array<{ name: string; value: string }>;
                body?: { data?: string };
                parts?: Array<{
                  mimeType: string;
                  body?: { data?: string };
                }>;
              };
            };

            const headers = msg.payload?.headers ?? [];
            const getHeader = (name: string) =>
              headers.find(
                (h) => h.name.toLowerCase() === name.toLowerCase(),
              )?.value;

            const result: Record<string, unknown> = {
              id: msg.id,
              threadId: msg.threadId,
              subject: getHeader("Subject") || "(no subject)",
              from: getHeader("From") || "unknown",
              to: getHeader("To"),
              date: getHeader("Date"),
              snippet: msg.snippet,
              isUnread: msg.labelIds?.includes("UNREAD") ?? false,
            };

            if (includeBody && msg.payload) {
              result.body = extractBodyText(msg.payload);
            }

            return result;
          } catch (fetchError) {
            console.error(`Failed to fetch Gmail message ${m.id}:`, fetchError);
            return null;
          }
        }),
      );

      const validMessages = messages.filter(Boolean);

      return {
        success: true,
        data: {
          messages: validMessages,
          resultCount: validMessages.length,
          message: `Found ${validMessages.length} email(s).`,
        },
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// gmail_search — Search emails (alias with required query)
// ---------------------------------------------------------------------------

export const gmailSearch = createTool({
  name: "gmail_search",
  description:
    "Search the user's Gmail using Gmail search syntax. " +
    "Use when the user asks to find specific emails, search for messages from a person, " +
    "look for emails about a topic, or find emails within a date range. " +
    "Supports the same query syntax as the Gmail search bar: " +
    "'from:alice@example.com', 'subject:invoice', 'has:attachment', " +
    "'after:2026/01/01', 'is:starred', 'label:important', etc.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Gmail search query (required). Same syntax as Gmail search bar.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results (default 10, max 20).",
      },
    },
    required: ["query"],
  },

  execute: async (toolCtx, args) => {
    // Delegate to gmail_read's execute with the search query
    return gmailRead.execute(toolCtx, {
      query: args.query,
      max_results: args.max_results || 10,
      include_body: false,
    });
  },
});

// ---------------------------------------------------------------------------
// gmail_delete — Move emails to Trash
// ---------------------------------------------------------------------------

export const gmailDelete = createTool({
  name: "gmail_delete",
  description:
    "Move one or more emails to Trash in the user's Gmail. " +
    "Use when the user asks to delete, remove, or trash emails. " +
    "Emails in Trash are automatically permanently deleted after 30 days. " +
    "Requires message IDs, which you can get from gmail_read or gmail_search results.",
  parameters: {
    type: "object",
    properties: {
      message_ids: {
        type: "array",
        description:
          "Array of Gmail message IDs to move to Trash. " +
          "Get these from the 'id' field in gmail_read or gmail_search results.",
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
        error: "Missing required field: 'message_ids' (must be a non-empty array).",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "gmail",
      );

      const results = await Promise.all(
        messageIds.map(async (id) => {
          try {
            const response = await fetch(
              `${GMAIL_API}/messages/${encodeURIComponent(id)}/trash`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
              },
            );

            if (response.ok) {
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
            trashedCount: succeeded,
            message: `${succeeded} email(s) moved to Trash.`,
          },
        };
      }

      return {
        success: succeeded > 0,
        data: {
          trashedCount: succeeded,
          failedCount: failed.length,
          failures: failed.map((f) => ({ id: f.id, error: f.error })),
          message:
            succeeded > 0
              ? `${succeeded} email(s) trashed, ${failed.length} failed.`
              : `Failed to trash ${failed.length} email(s).`,
        },
        error:
          succeeded === 0
            ? `All ${failed.length} delete(s) failed.`
            : undefined,
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Helper: extract plain text body from Gmail message payload
// ---------------------------------------------------------------------------

function extractBodyText(payload: {
  body?: { data?: string };
  parts?: Array<{
    mimeType: string;
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  }>;
}): string {
  if (!payload) return "";

  // Direct body (simple messages)
  if (payload.body?.data) {
    return base64UrlDecode(payload.body.data);
  }

  // Multipart — find text/plain part
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return base64UrlDecode(part.body.data);
      }
      // Nested multipart
      if (part.parts) {
        const nested = extractBodyText(part);
        if (nested) return nested;
      }
    }
    // Fallback to text/html if no text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = base64UrlDecode(part.body.data);
        // Strip HTML tags for a rough plain text version
        return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      }
    }
  }

  return "";
}

function base64UrlDecode(data: string): string {
  // Convert base64url to standard base64
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  // Decode via binary string → Uint8Array → TextDecoder for proper UTF-8
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// gmail_modify_labels — Add/remove labels (move to folder, archive, etc.)
// ---------------------------------------------------------------------------

export const gmailModifyLabels = createTool({
  name: "gmail_modify_labels",
  description:
    "Modify labels on Gmail messages to move them between folders, archive, " +
    "mark as read/unread, star/unstar, or apply custom labels. " +
    "Gmail uses labels instead of folders — moving a message means adding one label " +
    "and removing another. Common operations:\n" +
    "- Archive: remove 'INBOX' label\n" +
    "- Move to Inbox: add 'INBOX' label\n" +
    "- Mark as read: remove 'UNREAD' label\n" +
    "- Mark as unread: add 'UNREAD' label\n" +
    "- Star: add 'STARRED' label\n" +
    "- Move to Trash: add 'TRASH' label (prefer gmail_delete instead)\n" +
    "- Apply a custom label: add the label ID (use gmail_list_labels to find IDs)\n" +
    "Common system label IDs: INBOX, SPAM, TRASH, UNREAD, STARRED, IMPORTANT, " +
    "CATEGORY_PERSONAL, CATEGORY_SOCIAL, CATEGORY_PROMOTIONS, CATEGORY_UPDATES, CATEGORY_FORUMS.",
  parameters: {
    type: "object",
    properties: {
      message_ids: {
        type: "array",
        description:
          "Array of Gmail message IDs to modify. " +
          "Get these from the 'id' field in gmail_read or gmail_search results.",
        items: { type: "string" },
      },
      add_labels: {
        type: "array",
        description:
          "Label IDs to add (optional). Use system IDs like 'INBOX', 'STARRED', 'UNREAD', " +
          "or custom label IDs from gmail_list_labels.",
        items: { type: "string" },
      },
      remove_labels: {
        type: "array",
        description:
          "Label IDs to remove (optional). Use system IDs like 'INBOX', 'UNREAD', " +
          "'STARRED', or custom label IDs.",
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
      return {
        success: false,
        data: null,
        error: "Missing required field: 'message_ids' (must be a non-empty array).",
      };
    }

    if (addLabels.length === 0 && removeLabels.length === 0) {
      return {
        success: false,
        data: null,
        error: "At least one of 'add_labels' or 'remove_labels' must be provided.",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "gmail",
      );

      // Use batchModify for multiple messages (more efficient than individual calls)
      if (messageIds.length > 1) {
        const response = await fetch(
          `${GMAIL_API}/messages/batchModify`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ids: messageIds,
              addLabelIds: addLabels.length > 0 ? addLabels : undefined,
              removeLabelIds: removeLabels.length > 0 ? removeLabels : undefined,
            }),
          },
        );

        // batchModify returns 204 No Content on success
        if (response.status === 204 || response.ok) {
          return {
            success: true,
            data: {
              modifiedCount: messageIds.length,
              addedLabels: addLabels,
              removedLabels: removeLabels,
              message: `Modified labels on ${messageIds.length} message(s).` +
                (addLabels.length > 0 ? ` Added: ${addLabels.join(", ")}.` : "") +
                (removeLabels.length > 0 ? ` Removed: ${removeLabels.join(", ")}.` : ""),
            },
          };
        }

        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Gmail batchModify failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      // Single message — use modify endpoint
      const response = await fetch(
        `${GMAIL_API}/messages/${encodeURIComponent(messageIds[0])}/modify`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            addLabelIds: addLabels.length > 0 ? addLabels : undefined,
            removeLabelIds: removeLabels.length > 0 ? removeLabels : undefined,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Gmail modify failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        data: {
          modifiedCount: 1,
          addedLabels: addLabels,
          removedLabels: removeLabels,
          message: `Modified labels on 1 message.` +
            (addLabels.length > 0 ? ` Added: ${addLabels.join(", ")}.` : "") +
            (removeLabels.length > 0 ? ` Removed: ${removeLabels.join(", ")}.` : ""),
        },
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// gmail_list_labels — List available labels (needed for modify operations)
// ---------------------------------------------------------------------------

export const gmailListLabels = createTool({
  name: "gmail_list_labels",
  description:
    "List all Gmail labels available in the user's account. " +
    "Use this to discover label IDs for use with gmail_modify_labels. " +
    "Returns both system labels (INBOX, SPAM, TRASH, etc.) and " +
    "user-created labels (custom folders/categories). " +
    "Each label has an 'id' (use this for modify operations) and a 'name' (human-readable).",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  execute: async (toolCtx, _args) => {
    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "gmail",
      );

      const response = await fetch(`${GMAIL_API}/labels`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Gmail list labels failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        labels?: Array<{
          id: string;
          name: string;
          type: string;
          messageListVisibility?: string;
          labelListVisibility?: string;
        }>;
      };

      const labels = (data.labels || []).map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type, // "system" or "user"
      }));

      // Sort: system labels first, then user labels alphabetically
      labels.sort((a, b) => {
        if (a.type !== b.type) return a.type === "system" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        data: {
          labels,
          labelCount: labels.length,
          message: `Found ${labels.length} label(s) in Gmail.`,
        },
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
