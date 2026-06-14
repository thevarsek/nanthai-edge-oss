import { makeFunctionReference, type FunctionReference } from "convex/server";
import { createActionProxyTool, type ExecuteProxyToolArgs } from "../action_proxy";
import type { ToolResult } from "../registry";

type GmailToolName =
  | "gmail_send"
  | "gmail_create_draft"
  | "gmail_read"
  | "gmail_search"
  | "gmail_delete"
  | "gmail_modify_labels"
  | "gmail_list_labels";

const executeGmailToolRef = makeFunctionReference<
  "action",
  ExecuteProxyToolArgs<GmailToolName>,
  ToolResult
>("tools/google/gmail_actions:executeGmailTool") as unknown as FunctionReference<
  "action",
  "internal",
  ExecuteProxyToolArgs<GmailToolName>,
  ToolResult
>;

export const gmailSend = createActionProxyTool(executeGmailToolRef, "gmail_send", { name: "gmail_send", description: "Send an email via the user's manually connected Gmail account. Use when the user asks you to send an email, reply to someone, or draft and send a message. The email is sent immediately from the user's Gmail address. Supports plain text and HTML bodies.", parameters: {"type":"object","properties":{"to":{"type":"string","description":"Recipient email address."},"subject":{"type":"string","description":"Email subject line."},"body":{"type":"string","description":"Email body content."},"is_html":{"type":"boolean","description":"Whether the body is HTML."},"cc":{"type":"string","description":"Optional CC recipients, comma-separated."},"bcc":{"type":"string","description":"Optional BCC recipients, comma-separated."}},"required":["to","subject","body"],"additionalProperties":false} });

export const gmailCreateDraft = createActionProxyTool(executeGmailToolRef, "gmail_create_draft", { name: "gmail_create_draft", description: "Create a draft email in the user's manually connected Gmail Drafts folder using IMAP append. Use when the user asks to draft an email without sending it. The draft is saved for the user to review in Gmail.", parameters: {"type":"object","properties":{"to":{"type":"string","description":"Recipient email address."},"subject":{"type":"string","description":"Email subject line."},"body":{"type":"string","description":"Email body content."},"is_html":{"type":"boolean","description":"Whether the body is HTML."},"cc":{"type":"string","description":"Optional CC recipients, comma-separated."},"bcc":{"type":"string","description":"Optional BCC recipients, comma-separated."}},"required":["to","subject","body"],"additionalProperties":false} });

export const gmailRead = createActionProxyTool(executeGmailToolRef, "gmail_read", { name: "gmail_read", description: "Read recent emails from the user's manually connected Gmail inbox. Returns subject, sender, date, and snippet/body for each email. Search supports a practical subset of Gmail syntax such as from:, to:, subject:, after:, before:, is:unread, is:read, and is:starred.", parameters: {"type":"object","properties":{"query":{"type":"string","description":"Optional Gmail-style search query."},"max_results":{"type":"number","description":"Maximum number of emails to return (default 10, max 20)."},"include_body":{"type":"boolean","description":"Whether to include body text."}},"required":[],"additionalProperties":false} });

export const gmailSearch = createActionProxyTool(executeGmailToolRef, "gmail_search", { name: "gmail_search", description: "Search the user's manually connected Gmail account. Supports a practical subset of Gmail query syntax: from:, to:, subject:, after:, before:, is:unread, is:read, is:starred, plus free-text body search.", parameters: {"type":"object","properties":{"query":{"type":"string","description":"Gmail-style search query."},"max_results":{"type":"number","description":"Maximum results (default 10, max 20)."}},"required":["query"],"additionalProperties":false} });

export const gmailDelete = createActionProxyTool(executeGmailToolRef, "gmail_delete", { name: "gmail_delete", description: "Move one or more Gmail messages to Trash. Requires message IDs returned by gmail_read or gmail_search.", parameters: {"type":"object","properties":{"message_ids":{"type":"array","description":"Array of Gmail message IDs.","items":{"type":"string"}}},"required":["message_ids"],"additionalProperties":false} });

export const gmailModifyLabels = createActionProxyTool(executeGmailToolRef, "gmail_modify_labels", { name: "gmail_modify_labels", description: "Modify Gmail labels/flags. Common operations: archive by removing INBOX, mark read by removing UNREAD, mark unread by adding UNREAD, star by adding STARRED, unstar by removing STARRED, trash by adding TRASH.", parameters: {"type":"object","properties":{"message_ids":{"type":"array","description":"Array of Gmail message IDs.","items":{"type":"string"}},"add_labels":{"type":"array","description":"Label IDs/names to add.","items":{"type":"string"}},"remove_labels":{"type":"array","description":"Label IDs/names to remove.","items":{"type":"string"}}},"required":["message_ids"],"additionalProperties":false} });

export const gmailListLabels = createActionProxyTool(executeGmailToolRef, "gmail_list_labels", { name: "gmail_list_labels", description: "List Gmail labels/folders available through the user's Manual Gmail IMAP connection.", parameters: {"type":"object","properties":{},"required":[],"additionalProperties":false} });
