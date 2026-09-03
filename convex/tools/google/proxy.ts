import { makeFunctionReference, type FunctionReference } from "convex/server";
import { createActionProxyTool, type ExecuteProxyToolArgs } from "../action_proxy";
import type { ToolResult } from "../registry";

type GoogleToolName =
  | "drive_upload"
  | "drive_list"
  | "drive_read"
  | "drive_move"
  | "google_calendar_list"
  | "google_calendar_create"
  | "google_calendar_delete";

const executeGoogleToolRef = makeFunctionReference<
  "action",
  ExecuteProxyToolArgs<GoogleToolName>,
  ToolResult
>("tools/google/actions:executeGoogleTool") as unknown as FunctionReference<
  "action",
  "internal",
  ExecuteProxyToolArgs<GoogleToolName>,
  ToolResult
>;

export const driveUpload = createActionProxyTool(executeGoogleToolRef, "drive_upload", { name: "drive_upload", description: "Upload a file to the user's Google Drive. Use when the user asks to save a generated document or media asset to Drive, upload a file they've created, or back up content to Google Drive. Requires a Convex storage ID from a previously generated file or media result (e.g. DOCX, XLSX, PPTX, image, audio, or video).", parameters: {"type":"object","properties":{"storage_id":{"type":"string","description":"Convex storage ID of the file or media asset to upload (from a prior tool result)."},"filename":{"type":"string","description":"Filename for the file in Google Drive (e.g. 'Report.docx'). Use an extension matching the source content; this tool does not transcode files."},"folder_id":{"type":"string","description":"Google Drive folder ID to upload into (optional, defaults to root)."},"mime_type":{"type":"string","description":"MIME type of the file (optional, auto-detected from filename if omitted)."}},"required":["storage_id","filename"],"additionalProperties":false} });

export const driveList = createActionProxyTool(executeGoogleToolRef, "drive_list", { name: "drive_list", description: "List or search Google Drive files that the user explicitly selected for NanthAI or files NanthAI created/uploaded. This does not search the user's entire Drive. If the requested file is not listed, ask the user to pick it in the Google Drive picker.", parameters: {"type":"object","properties":{"query":{"type":"string","description":"Optional case-insensitive filename search over files already selected for NanthAI."},"max_results":{"type":"integer","description":"Maximum number of files to return (default 20, max 50)."}},"required":[],"additionalProperties":false} });

export const driveRead = createActionProxyTool(executeGoogleToolRef, "drive_read", { name: "drive_read", description: "Read the content of a file from Google Drive. Use when the user asks to read, review, summarize, or analyze a Google Drive file. Google Docs are exported as plain text, Sheets as CSV, and Slides as plain text. Regular files (txt, csv, json, md, etc.) are downloaded directly. Binary files (images, PDFs, etc.) return metadata only. Requires the file ID, which can be obtained from drive_list.", parameters: {"type":"object","properties":{"file_id":{"type":"string","description":"Google Drive file ID (from drive_list results)."}},"required":["file_id"],"additionalProperties":false} });

export const driveMove = createActionProxyTool(executeGoogleToolRef, "drive_move", { name: "drive_move", description: "Move a file to a different folder in the user's Google Drive. Use when the user asks to move a file into a folder, organize their Drive, or file a document into a specific location. Requires the file ID (from drive_list) and the destination folder ID. Use 'root' as the destination_folder_id for the top-level of My Drive.", parameters: {"type":"object","properties":{"file_id":{"type":"string","description":"Google Drive file ID to move (from drive_list results)."},"destination_folder_id":{"type":"string","description":"Destination folder ID. Use 'root' for the top-level of My Drive, or a folder ID from drive_list."}},"required":["file_id","destination_folder_id"],"additionalProperties":false} });

export const calendarList = createActionProxyTool(executeGoogleToolRef, "google_calendar_list", { name: "google_calendar_list", description: "List upcoming events from the user's Google Calendar. Use when the user asks about their schedule, upcoming meetings, what's on their calendar, or events for a specific date/range. Returns event title, start/end times, location, and description.", parameters: {"type":"object","properties":{"max_results":{"type":"number","description":"Maximum number of events to return (default 10, max 50)."},"time_min":{"type":"string","description":"Start of time range as ISO 8601 string (optional, defaults to now). Example: '2026-03-04T00:00:00Z'."},"time_max":{"type":"string","description":"End of time range as ISO 8601 string (optional). Example: '2026-03-11T23:59:59Z'."},"query":{"type":"string","description":"Free text search query to filter events (optional). Searches summary, description, location, and attendees."}},"required":[],"additionalProperties":false} });

export const calendarCreate = createActionProxyTool(executeGoogleToolRef, "google_calendar_create", { name: "google_calendar_create", description: "Create a new event on the user's Google Calendar. Use when the user asks to schedule a meeting, add an event, set a reminder, or create a calendar entry. Requires at minimum a title and start/end times. IMPORTANT: Always include a timezone offset in ISO times (e.g. '+01:00', '-05:00') or pass the 'timezone' parameter. If the user's timezone is unknown, ask them. The user's Google Calendar timezone will be used as a fallback.", parameters: {"type":"object","properties":{"summary":{"type":"string","description":"Event title/summary."},"start_time":{"type":"string","description":"Event start time as ISO 8601 string. Example: '2026-03-05T14:00:00+01:00'. For all-day events use date format: '2026-03-05'."},"end_time":{"type":"string","description":"Event end time as ISO 8601 string. Example: '2026-03-05T15:00:00+01:00'. For all-day events use date format: '2026-03-06' (day after)."},"description":{"type":"string","description":"Event description/notes (optional)."},"location":{"type":"string","description":"Event location — physical address or virtual meeting link (optional)."},"attendees":{"type":"array","description":"Email addresses of attendees to invite (optional).","items":{"type":"string"}},"timezone":{"type":"string","description":"IANA timezone for the event (optional, e.g. 'Europe/Rome', 'America/New_York'). Defaults to the calendar's timezone if not specified."}},"required":["summary","start_time","end_time"],"additionalProperties":false} });

export const calendarDelete = createActionProxyTool(executeGoogleToolRef, "google_calendar_delete", { name: "google_calendar_delete", description: "Delete an event from the user's Google Calendar. Use when the user asks to remove, cancel, or delete a calendar event. Requires the event ID, which you can get from google_calendar_list.", parameters: {"type":"object","properties":{"event_id":{"type":"string","description":"The Google Calendar event ID to delete. Get this from the 'id' field in google_calendar_list results."}},"required":["event_id"],"additionalProperties":false} });
