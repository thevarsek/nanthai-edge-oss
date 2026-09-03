import { makeFunctionReference, type FunctionReference } from "convex/server";
import { createActionProxyTool, type ExecuteProxyToolArgs } from "../action_proxy";
import type { ToolResult } from "../registry";
import { STORAGE_ATTACHMENTS_PARAMETER } from "../storage_attachment_schema";

type MicrosoftToolName =
  | "outlook_send"
  | "outlook_create_draft"
  | "outlook_read"
  | "outlook_search"
  | "outlook_delete"
  | "outlook_move"
  | "outlook_list_folders"
  | "onedrive_upload"
  | "onedrive_list"
  | "onedrive_read"
  | "onedrive_move"
  | "ms_calendar_list"
  | "ms_calendar_create"
  | "ms_calendar_delete";

const executeMicrosoftToolRef = makeFunctionReference<
  "action",
  ExecuteProxyToolArgs<MicrosoftToolName>,
  ToolResult
>("tools/microsoft/actions:executeMicrosoftTool") as unknown as FunctionReference<
  "action",
  "internal",
  ExecuteProxyToolArgs<MicrosoftToolName>,
  ToolResult
>;

export const outlookSend = createActionProxyTool(executeMicrosoftToolRef, "outlook_send", { name: "outlook_send", description: "Send an email via the user's connected Microsoft Outlook account. Use when the user asks you to send an email, reply to someone, or draft and send a message through their Microsoft/Outlook account. The email is sent immediately from the user's Outlook address. Supports plain text and HTML bodies. For CC/BCC, include them in the appropriate fields.", parameters: {"type":"object","properties":{"to":{"type":"string","description":"Recipient email address (e.g. 'user@example.com')."},"subject":{"type":"string","description":"Email subject line."},"body":{"type":"string","description":"Email body content (plain text or HTML)."},"is_html":{"type":"boolean","description":"Whether the body is HTML (default: false for plain text)."},"cc":{"type":"string","description":"CC recipient email address (optional). For multiple, comma-separate."},"bcc":{"type":"string","description":"BCC recipient email address (optional). For multiple, comma-separate."}},"required":["to","subject","body"],"additionalProperties":false} });

export const outlookCreateDraft = createActionProxyTool(executeMicrosoftToolRef, "outlook_create_draft", {
  name: "outlook_create_draft",
  description: "Create an Outlook draft for review without sending it. May include user-owned files or generated-media attachments.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email addresses, comma-separated." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Email body content." },
      is_html: { type: "boolean", description: "Whether the body is HTML." },
      cc: { type: "string", description: "Optional CC recipients, comma-separated." },
      bcc: { type: "string", description: "Optional BCC recipients, comma-separated." },
      attachments: STORAGE_ATTACHMENTS_PARAMETER,
    },
    required: ["to", "subject", "body"],
    additionalProperties: false,
  },
});

export const outlookRead = createActionProxyTool(executeMicrosoftToolRef, "outlook_read", { name: "outlook_read", description: "Read recent emails from the user's Microsoft Outlook inbox. Returns subject, sender, date, and preview for each email. Use when the user asks to check their Outlook email, see recent messages, or wants you to read their inbox. Optionally filter by folder or use OData query syntax.", parameters: {"type":"object","properties":{"folder":{"type":"string","description":"Mail folder to read from (optional). Common values: 'inbox' (default), 'sentitems', 'drafts', 'deleteditems', 'archive'."},"max_results":{"type":"number","description":"Maximum number of emails to return (default 10, max 20)."},"include_body":{"type":"boolean","description":"Whether to include the full email body text (default: false, only preview)."},"filter":{"type":"string","description":"OData $filter expression (optional). Examples: \"isRead eq false\", \"from/emailAddress/address eq 'boss@company.com'\", \"receivedDateTime ge 2026-01-01T00:00:00Z\"."}},"required":[],"additionalProperties":false} });

export const outlookSearch = createActionProxyTool(executeMicrosoftToolRef, "outlook_search", { name: "outlook_search", description: "Search the user's Outlook emails using Microsoft Graph search. Use when the user asks to find specific emails, search for messages from a person, look for emails about a topic, or find emails within a date range. Uses OData $search for keyword queries and $filter for structured filtering. Examples: search 'invoice' to find emails containing 'invoice', or filter \"from/emailAddress/address eq 'alice@example.com'\".", parameters: {"type":"object","properties":{"query":{"type":"string","description":"Search keyword query (required). Searches subject, body, and other fields. Examples: 'quarterly report', 'from:alice', 'invoice 2026'."},"max_results":{"type":"number","description":"Maximum number of results (default 10, max 20)."}},"required":["query"],"additionalProperties":false} });

export const outlookDelete = createActionProxyTool(executeMicrosoftToolRef, "outlook_delete", { name: "outlook_delete", description: "Move one or more emails to the Deleted Items folder in the user's Outlook. Use when the user asks to delete, remove, or trash emails. Requires message IDs, which you can get from outlook_read or outlook_search results.", parameters: {"type":"object","properties":{"message_ids":{"type":"array","description":"Array of Outlook message IDs to delete. Get these from the 'id' field in outlook_read or outlook_search results.","items":{"type":"string"}}},"required":["message_ids"],"additionalProperties":false} });

export const outlookMove = createActionProxyTool(executeMicrosoftToolRef, "outlook_move", { name: "outlook_move", description: "Move one or more emails to a different mail folder in the user's Outlook. Use when the user asks to move emails to a folder, organize their inbox, archive messages, or file emails into specific folders. Requires message IDs (from outlook_read or outlook_search) and a destination folder. You can use well-known folder names ('inbox', 'archive', 'drafts', 'sentitems', 'deleteditems', 'junkemail') or a folder ID from outlook_list_folders.", parameters: {"type":"object","properties":{"message_ids":{"type":"array","description":"Array of Outlook message IDs to move. Get these from the 'id' field in outlook_read or outlook_search results.","items":{"type":"string"}},"destination_folder":{"type":"string","description":"Destination folder. Use well-known names ('inbox', 'archive', 'drafts', 'sentitems', 'deleteditems', 'junkemail') or a folder ID from outlook_list_folders."}},"required":["message_ids","destination_folder"],"additionalProperties":false} });

export const outlookListFolders = createActionProxyTool(executeMicrosoftToolRef, "outlook_list_folders", { name: "outlook_list_folders", description: "List all mail folders in the user's Outlook account. Use this to discover folder IDs for use with outlook_move. Returns both well-known folders (Inbox, Sent Items, Drafts, etc.) and user-created folders. Each folder has an 'id' (use this for move operations) and a 'displayName' (human-readable).", parameters: {"type":"object","properties":{"parent_folder_id":{"type":"string","description":"Parent folder ID to list child folders of (optional). Omit to list top-level folders."}},"required":[],"additionalProperties":false} });

export const onedriveUpload = createActionProxyTool(executeMicrosoftToolRef, "onedrive_upload", { name: "onedrive_upload", description: "Upload a file to the user's OneDrive. Use when the user asks to save a generated document or media asset to OneDrive, upload a file they've created, or back up content to Microsoft OneDrive. Requires a Convex storage ID from a previously generated file or media result (e.g. DOCX, XLSX, PPTX, image, audio, or video).", parameters: {"type":"object","properties":{"storage_id":{"type":"string","description":"Convex storage ID of the file or media asset to upload (from a prior tool result)."},"filename":{"type":"string","description":"Filename for the file in OneDrive (e.g. 'Report.docx'). Use an extension matching the source content; this tool does not transcode files."},"folder_path":{"type":"string","description":"OneDrive folder path to upload into (optional, defaults to root). Example: '/Documents/Reports'."}},"required":["storage_id","filename"],"additionalProperties":false} });

export const onedriveList = createActionProxyTool(executeMicrosoftToolRef, "onedrive_list", { name: "onedrive_list", description: "List or search files in the user's OneDrive. Use when the user asks to see their OneDrive files, find a document, or check what's in their Microsoft OneDrive. Supports keyword search and folder browsing.", parameters: {"type":"object","properties":{"query":{"type":"string","description":"Search keyword query (optional). Searches file names and content."},"folder_path":{"type":"string","description":"List files in a specific folder by path (optional, defaults to root). Example: '/Documents/Reports'."},"max_results":{"type":"number","description":"Maximum number of files to return (default 20, max 50)."}},"required":[],"additionalProperties":false} });

export const onedriveRead = createActionProxyTool(executeMicrosoftToolRef, "onedrive_read", { name: "onedrive_read", description: "Read the content of a file from OneDrive. Use when the user asks to read, review, summarize, or analyze a OneDrive file. Text-based files (txt, csv, json, md, etc.) are downloaded and returned directly. Binary files (images, PDFs, etc.) return metadata only. Requires the file ID, which can be obtained from onedrive_list.", parameters: {"type":"object","properties":{"file_id":{"type":"string","description":"OneDrive file ID (from onedrive_list results)."}},"required":["file_id"],"additionalProperties":false} });

export const onedriveMove = createActionProxyTool(executeMicrosoftToolRef, "onedrive_move", { name: "onedrive_move", description: "Move a file or folder to a different location in the user's OneDrive. Use when the user asks to move a file into a folder, organize their OneDrive, or file a document into a specific location. Requires the item ID (from onedrive_list) and a destination. You can specify the destination as a folder ID or a folder path. Optionally rename the file during the move by providing a new name.", parameters: {"type":"object","properties":{"item_id":{"type":"string","description":"OneDrive item ID to move (from onedrive_list results)."},"destination_folder_id":{"type":"string","description":"Destination folder ID (from onedrive_list results). Use 'root' for the top-level of OneDrive. Either destination_folder_id or destination_folder_path is required."},"destination_folder_path":{"type":"string","description":"Destination folder path (e.g. '/Documents/Reports'). Alternative to destination_folder_id. Either destination_folder_id or destination_folder_path is required."},"new_name":{"type":"string","description":"New filename for the item (optional). If omitted, the item keeps its current name."}},"required":["item_id"],"additionalProperties":false} });

export const msCalendarList = createActionProxyTool(executeMicrosoftToolRef, "ms_calendar_list", { name: "ms_calendar_list", description: "List upcoming events from the user's Microsoft Outlook Calendar. Use when the user asks about their schedule, upcoming meetings, what's on their Outlook/Microsoft calendar, or events for a specific date/range. Returns event title, start/end times, location, and description.", parameters: {"type":"object","properties":{"max_results":{"type":"number","description":"Maximum number of events to return (default 10, max 50)."},"time_min":{"type":"string","description":"Start of time range as ISO 8601 string (optional, defaults to now). Example: '2026-03-04T00:00:00Z'."},"time_max":{"type":"string","description":"End of time range as ISO 8601 string (optional). Example: '2026-03-11T23:59:59Z'."},"query":{"type":"string","description":"Free text search query to filter events (optional). Searches subject and body."}},"required":[],"additionalProperties":false} });

export const msCalendarCreate = createActionProxyTool(executeMicrosoftToolRef, "ms_calendar_create", { name: "ms_calendar_create", description: "Create a new event on the user's Microsoft Outlook Calendar. Use when the user asks to schedule a meeting, add an event, set a reminder, or create a calendar entry via their Microsoft account. Requires at minimum a title and start/end times. IMPORTANT: Always include a timezone in the 'timezone' parameter or use ISO times with timezone offsets. If the user's timezone is unknown, ask them. The user's Outlook mailbox timezone will be used as a fallback.", parameters: {"type":"object","properties":{"summary":{"type":"string","description":"Event title/summary."},"start_time":{"type":"string","description":"Event start time as ISO 8601 string. Example: '2026-03-05T14:00:00'. For all-day events use date format: '2026-03-05'."},"end_time":{"type":"string","description":"Event end time as ISO 8601 string. Example: '2026-03-05T15:00:00'. For all-day events use date format: '2026-03-06' (day after)."},"description":{"type":"string","description":"Event description/notes (optional)."},"location":{"type":"string","description":"Event location — physical address or virtual meeting link (optional)."},"attendees":{"type":"array","description":"Email addresses of attendees to invite (optional).","items":{"type":"string"}},"timezone":{"type":"string","description":"Windows timezone name for the event (optional, e.g. 'Eastern Standard Time', 'Pacific Standard Time', 'W. Europe Standard Time'). Defaults to the user's mailbox timezone if not specified."}},"required":["summary","start_time","end_time"],"additionalProperties":false} });

export const msCalendarDelete = createActionProxyTool(executeMicrosoftToolRef, "ms_calendar_delete", { name: "ms_calendar_delete", description: "Delete an event from the user's Microsoft Outlook Calendar. Use when the user asks to remove, cancel, or delete a calendar event. Requires the event ID, which you can get from ms_calendar_list.", parameters: {"type":"object","properties":{"event_id":{"type":"string","description":"The Microsoft Calendar event ID to delete. Get this from the 'id' field in ms_calendar_list results."}},"required":["event_id"],"additionalProperties":false} });
