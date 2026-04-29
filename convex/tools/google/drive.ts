// convex/tools/google/drive.ts
// =============================================================================
// Google Drive tools: upload files and list/search files.
//
// Uses raw `fetch` against https://www.googleapis.com/drive — no Node.js SDK.
// Tokens are obtained via `getGoogleAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getGoogleAccessToken, googleCapabilityToolError } from "./auth";
import { internal } from "../../_generated/api";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// ---------------------------------------------------------------------------
// drive_upload — Upload a Convex-stored file to Google Drive
// ---------------------------------------------------------------------------

export const driveUpload = createTool({
  name: "drive_upload",
  description:
    "Upload a file to the user's Google Drive. " +
    "Use when the user asks to save a generated document to Drive, " +
    "upload a file they've created, or back up content to Google Drive. " +
    "Requires a Convex storage ID from a previously generated file " +
    "(e.g. from generate_docx, generate_xlsx, generate_pptx, etc.).",
  parameters: {
    type: "object",
    properties: {
      storage_id: {
        type: "string",
        description:
          "Convex storage ID of the file to upload (from a generate_* tool result).",
      },
      filename: {
        type: "string",
        description:
          "Filename for the file in Google Drive (e.g. 'Report.docx').",
      },
      folder_id: {
        type: "string",
        description:
          "Google Drive folder ID to upload into (optional, defaults to root).",
      },
      mime_type: {
        type: "string",
        description:
          "MIME type of the file (optional, auto-detected from filename if omitted).",
      },
    },
    required: ["storage_id", "filename"],
  },

  execute: async (toolCtx, args) => {
    const storageId = args.storage_id as string;
    const filename = args.filename as string;
    const folderId = args.folder_id as string | undefined;
    const mimeType = (args.mime_type as string) || guessMimeType(filename);

    if (!storageId || !filename) {
      return {
        success: false,
        data: null,
        error: "Missing 'storage_id' or 'filename'.",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "drive",
      );

      // Fetch file content from Convex storage
      const fileUrl = await toolCtx.ctx.storage.getUrl(storageId);
      if (!fileUrl) {
        return {
          success: false,
          data: null,
          error: `File not found in storage (storageId: ${storageId}).`,
        };
      }

      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        return {
          success: false,
          data: null,
          error: `Failed to fetch file from storage (HTTP ${fileResponse.status}).`,
        };
      }

      const fileBlob = await fileResponse.blob();

      // Build multipart upload request
      // Using the simple upload API with metadata
      const metadata: Record<string, unknown> = { name: filename };
      if (folderId) {
        metadata.parents = [folderId];
      }

      // Use multipart upload: metadata + file content in one request
      const boundary = "nanthai_drive_upload_boundary";
      const metadataJson = JSON.stringify(metadata);
      const fileArrayBuffer = await fileBlob.arrayBuffer();
      const fileBytes = new Uint8Array(fileArrayBuffer);

      // Build multipart body manually
      const encoder = new TextEncoder();
      const parts: Uint8Array[] = [];

      // Metadata part
      const metadataPart = encoder.encode(
        `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${metadataJson}\r\n`,
      );
      parts.push(metadataPart);

      // File part
      const filePart = encoder.encode(
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      );
      parts.push(filePart);
      parts.push(fileBytes);
      parts.push(encoder.encode(`\r\n--${boundary}--`));

      // Concatenate all parts
      const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
      const body = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        body.set(part, offset);
        offset += part.length;
      }

      const uploadResponse = await fetch(
        `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: body,
        },
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        return {
          success: false,
          data: null,
          error: `Drive upload failed (HTTP ${uploadResponse.status}): ${errorText}`,
        };
      }

      const result = (await uploadResponse.json()) as {
        id: string;
        name: string;
        mimeType: string;
        webViewLink?: string;
        size?: string;
      };

      await toolCtx.ctx.runMutation(internal.oauth.google.recordDriveFileGrant, {
        userId: toolCtx.userId,
        fileId: result.id,
        name: result.name,
        mimeType: result.mimeType,
        webViewLink: result.webViewLink,
        size: result.size,
      });

      return {
        success: true,
        data: {
          fileId: result.id,
          name: result.name,
          mimeType: result.mimeType,
          webViewLink: result.webViewLink,
          message: result.webViewLink
            ? `File "${result.name}" uploaded to Google Drive. [Open in Drive](${result.webViewLink})`
            : `File "${result.name}" uploaded to Google Drive (ID: ${result.id}).`,
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
// drive_list — List or search files in Google Drive
// ---------------------------------------------------------------------------

export const driveList = createTool({
  name: "drive_list",
  description:
    "List or search Google Drive files that the user explicitly selected for NanthAI " +
    "or files NanthAI created/uploaded. This does not search the user's entire Drive. " +
    "If the requested file is not listed, ask the user to pick it in the Google Drive picker.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional case-insensitive filename search over files already selected for NanthAI.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of files to return (default 20, max 50).",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const query = args.query as string | undefined;
    const maxResults = Math.min((args.max_results as number) || 20, 50);

    try {
      await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "drive",
      );
      const grantResult = await toolCtx.ctx.runQuery(
        internal.oauth.google.listDriveFileGrantsInternal,
        { userId: toolCtx.userId, maxResults, query },
      ) as {
        rows: Array<{
          fileId: string;
          name: string;
          mimeType: string;
          size?: string;
          webViewLink?: string;
          lastUsedAt?: number;
          grantedAt: number;
        }>;
        totalGrantCount: number;
        matchedGrantCount?: number;
      };
      const grants = grantResult.rows;

      const files = grants.map((f) => ({
        id: f.fileId,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.lastUsedAt ? new Date(f.lastUsedAt).toISOString() : new Date(f.grantedAt).toISOString(),
        size: f.size ? formatFileSize(parseInt(f.size, 10)) : undefined,
        webViewLink: f.webViewLink,
      }));

      const trimmedQuery = query?.trim();
      const shouldOpenPicker =
        grantResult.totalGrantCount === 0 ||
        (trimmedQuery !== undefined && trimmedQuery.length > 0 && grants.length === 0);

      if (shouldOpenPicker) {
        const hasExistingGrants = grantResult.totalGrantCount > 0;
        return {
          success: true,
          data: {
            files,
            resultCount: 0,
            requiresDrivePicker: true,
            message:
              hasExistingGrants
                ? `No selected Google Drive files matched "${trimmedQuery}". Opening the Drive picker so the user can choose the right file.`
                : "No Google Drive files have been selected for NanthAI yet. Opening the Drive picker so the user can choose a file.",
          },
          deferred: {
            kind: "drive_picker",
            data: {
              query: query ?? null,
              reason: hasExistingGrants
                ? "no_matching_drive_file_grants"
                : "no_drive_file_grants",
            },
          },
        };
      }

      return {
        success: true,
        data: {
          files,
          resultCount: files.length,
          message: `Found ${files.length} file(s) in Google Drive.`,
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
// drive_read — Read/export content from a Google Drive file
// ---------------------------------------------------------------------------

/** Google Workspace MIME types → export format for text extraction. */
const EXPORT_MAP: Record<string, { mimeType: string; label: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "text/plain",
    label: "Google Doc",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "text/csv",
    label: "Google Sheet",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "text/plain",
    label: "Google Slides",
  },
  "application/vnd.google-apps.drawing": {
    mimeType: "image/svg+xml",
    label: "Google Drawing",
  },
};

/** Max bytes we'll return to the model to avoid context blowup (~100 KB). */
const MAX_READ_BYTES = 100_000;

export const driveRead = createTool({
  name: "drive_read",
  description:
    "Read the content of a file from Google Drive. " +
    "Use when the user asks to read, review, summarize, or analyze a Google Drive file. " +
    "Google Docs are exported as plain text, Sheets as CSV, and Slides as plain text. " +
    "Regular files (txt, csv, json, md, etc.) are downloaded directly. " +
    "Binary files (images, PDFs, etc.) return metadata only. " +
    "Requires the file ID, which can be obtained from drive_list.",
  parameters: {
    type: "object",
    properties: {
      file_id: {
        type: "string",
        description: "Google Drive file ID (from drive_list results).",
      },
    },
    required: ["file_id"],
  },

  execute: async (toolCtx, args) => {
    const fileId = args.file_id as string;

    if (!fileId) {
      return {
        success: false,
        data: null,
        error: "Missing 'file_id' parameter.",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "drive",
      );

      const grant = await toolCtx.ctx.runQuery(
        internal.oauth.google.getDriveFileGrantInternal,
        { userId: toolCtx.userId, fileId },
      );
      if (!grant) {
        return {
          success: false,
          data: {
            requiresDrivePicker: true,
            fileId,
          },
          error: "This Drive file has not been selected for NanthAI. Ask the user to pick it in the Google Drive picker first.",
        };
      }

      // Step 1: Get file metadata to determine type
      const metaResponse = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!metaResponse.ok) {
        const errorText = await metaResponse.text();
        return {
          success: false,
          data: null,
          error: `Failed to get file metadata (HTTP ${metaResponse.status}): ${errorText}`,
        };
      }

      const meta = (await metaResponse.json()) as {
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        webViewLink?: string;
      };

      // Step 2: Determine how to read the content
      const exportInfo = EXPORT_MAP[meta.mimeType];

      let content: string;
      let contentType: string;

      if (exportInfo) {
        // Google Workspace file → use export endpoint
        const exportResponse = await fetch(
          `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportInfo.mimeType)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!exportResponse.ok) {
          const errorText = await exportResponse.text();
          return {
            success: false,
            data: null,
            error: `Failed to export ${exportInfo.label} (HTTP ${exportResponse.status}): ${errorText}`,
          };
        }

        content = await exportResponse.text();
        contentType = exportInfo.label;
      } else if (isTextMimeType(meta.mimeType)) {
        // Regular text-based file → download directly
        const downloadResponse = await fetch(
          `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!downloadResponse.ok) {
          const errorText = await downloadResponse.text();
          return {
            success: false,
            data: null,
            error: `Failed to download file (HTTP ${downloadResponse.status}): ${errorText}`,
          };
        }

        content = await downloadResponse.text();
        contentType = meta.mimeType;
      } else {
        // Binary file — return metadata only, no content extraction
        return {
          success: true,
          data: {
            fileId: meta.id,
            name: meta.name,
            mimeType: meta.mimeType,
            size: meta.size ? formatFileSize(parseInt(meta.size, 10)) : "unknown",
            webViewLink: meta.webViewLink,
            content: null,
            message:
              `"${meta.name}" is a binary file (${meta.mimeType}) and cannot be read as text. ` +
              (meta.webViewLink
                ? `[Open in Google Drive](${meta.webViewLink})`
                : `File ID: ${meta.id}`),
          },
        };
      }

      // Step 3: Truncate if too large
      let truncated = false;
      if (content.length > MAX_READ_BYTES) {
        content = content.slice(0, MAX_READ_BYTES);
        truncated = true;
      }

      return {
        success: true,
        data: {
          fileId: meta.id,
          name: meta.name,
          mimeType: meta.mimeType,
          contentType,
          content,
          truncated,
          characterCount: content.length,
          message: truncated
            ? `Read first ${MAX_READ_BYTES.toLocaleString()} characters of "${meta.name}" (file was truncated).`
            : `Read "${meta.name}" (${content.length.toLocaleString()} characters).`,
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for MIME types we can safely read as text.
 */
function isTextMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  const textTypes = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/yaml",
    "application/csv",
    "application/ld+json",
    "application/xhtml+xml",
    "application/sql",
    "application/x-sh",
    "application/x-python",
    "application/typescript",
  ];
  return textTypes.includes(mimeType);
}

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    eml: "message/rfc822",
  };
  return mimeMap[ext || ""] || "application/octet-stream";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// drive_move — Move a file to a different folder in Google Drive
// ---------------------------------------------------------------------------

export const driveMove = createTool({
  name: "drive_move",
  description:
    "Move a file to a different folder in the user's Google Drive. " +
    "Use when the user asks to move a file into a folder, organize their Drive, " +
    "or file a document into a specific location. " +
    "Requires the file ID (from drive_list) and the destination folder ID. " +
    "To find folder IDs, use drive_list with a query like " +
    "\"mimeType='application/vnd.google-apps.folder' and name contains 'Reports'\".",
  parameters: {
    type: "object",
    properties: {
      file_id: {
        type: "string",
        description: "Google Drive file ID to move (from drive_list results).",
      },
      destination_folder_id: {
        type: "string",
        description:
          "Destination folder ID. Use 'root' for the top-level of My Drive, " +
          "or a folder ID from drive_list.",
      },
    },
    required: ["file_id", "destination_folder_id"],
  },

  execute: async (toolCtx, args) => {
    const fileId = args.file_id as string;
    const destinationFolderId = args.destination_folder_id as string;

    if (!fileId || !destinationFolderId) {
      return {
        success: false,
        data: null,
        error: "Missing 'file_id' or 'destination_folder_id'.",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "drive",
      );

      const grant = await toolCtx.ctx.runQuery(
        internal.oauth.google.getDriveFileGrantInternal,
        { userId: toolCtx.userId, fileId },
      );
      if (!grant) {
        return {
          success: false,
          data: {
            requiresDrivePicker: true,
            fileId,
          },
          error: "This Drive file has not been selected for NanthAI. Ask the user to pick it in the Google Drive picker first.",
        };
      }

      // Step 1: Get current parents so we can remove them
      const metaResponse = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,parents`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!metaResponse.ok) {
        const errorText = await metaResponse.text();
        return {
          success: false,
          data: null,
          error: `Failed to get file metadata (HTTP ${metaResponse.status}): ${errorText}`,
        };
      }

      const meta = (await metaResponse.json()) as {
        id: string;
        name: string;
        parents?: string[];
      };

      const previousParents = (meta.parents || []).join(",");

      // Step 2: Move the file by adding new parent and removing old ones
      const params = new URLSearchParams({
        addParents: destinationFolderId,
        fields: "id,name,parents,webViewLink",
      });
      if (previousParents) {
        params.set("removeParents", previousParents);
      }

      const moveResponse = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      if (!moveResponse.ok) {
        const errorText = await moveResponse.text();
        return {
          success: false,
          data: null,
          error: `Drive move failed (HTTP ${moveResponse.status}): ${errorText}`,
        };
      }

      const result = (await moveResponse.json()) as {
        id: string;
        name: string;
        parents?: string[];
        webViewLink?: string;
      };

      return {
        success: true,
        data: {
          fileId: result.id,
          name: result.name,
          newParents: result.parents,
          webViewLink: result.webViewLink,
          message: `Moved "${result.name}" to folder ${destinationFolderId}.` +
            (result.webViewLink ? ` [Open in Drive](${result.webViewLink})` : ""),
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
