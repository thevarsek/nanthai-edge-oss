// convex/tools/microsoft/onedrive.ts
// =============================================================================
// OneDrive tools: upload, list, and read files via Microsoft Graph.
//
// Uses raw `fetch` against https://graph.microsoft.com/v1.0 — no Node.js SDK.
// Tokens are obtained via `getMicrosoftAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getMicrosoftAccessToken } from "./auth";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

// ---------------------------------------------------------------------------
// onedrive_upload — Upload a Convex-stored file to OneDrive
// ---------------------------------------------------------------------------

export const onedriveUpload = createTool({
  name: "onedrive_upload",
  description:
    "Upload a file to the user's OneDrive. " +
    "Use when the user asks to save a generated document to OneDrive, " +
    "upload a file they've created, or back up content to Microsoft OneDrive. " +
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
          "Filename for the file in OneDrive (e.g. 'Report.docx').",
      },
      folder_path: {
        type: "string",
        description:
          "OneDrive folder path to upload into (optional, defaults to root). " +
          "Example: '/Documents/Reports'.",
      },
    },
    required: ["storage_id", "filename"],
  },

  execute: async (toolCtx, args) => {
    const storageId = args.storage_id as string;
    const filename = args.filename as string;
    const folderPath = (args.folder_path as string) || "";

    if (!storageId || !filename) {
      return {
        success: false,
        data: null,
        error: "Missing 'storage_id' or 'filename'.",
      };
    }

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
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
      const fileArrayBuffer = await fileBlob.arrayBuffer();

      // Build the upload path
      // PUT /me/drive/root:/path/filename:/content for simple upload (<4MB)
      const encodedFilename = encodeURIComponent(filename);
      let uploadPath: string;
      if (folderPath && folderPath !== "/") {
        const cleanFolder = folderPath.replace(/^\/|\/$/g, "");
        uploadPath = `${GRAPH_API}/drive/root:/${cleanFolder}/${encodedFilename}:/content`;
      } else {
        uploadPath = `${GRAPH_API}/drive/root:/${encodedFilename}:/content`;
      }

      const uploadResponse = await fetch(uploadPath, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: fileArrayBuffer,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        return {
          success: false,
          data: null,
          error: `OneDrive upload failed (HTTP ${uploadResponse.status}): ${errorText}`,
        };
      }

      const result = (await uploadResponse.json()) as {
        id: string;
        name: string;
        size?: number;
        webUrl?: string;
        file?: { mimeType?: string };
      };

      return {
        success: true,
        data: {
          fileId: result.id,
          name: result.name,
          size: result.size ? formatFileSize(result.size) : undefined,
          webUrl: result.webUrl,
          message: result.webUrl
            ? `File "${result.name}" uploaded to OneDrive. [Open in OneDrive](${result.webUrl})`
            : `File "${result.name}" uploaded to OneDrive (ID: ${result.id}).`,
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
// onedrive_list — List or search files in OneDrive
// ---------------------------------------------------------------------------

export const onedriveList = createTool({
  name: "onedrive_list",
  description:
    "List or search files in the user's OneDrive. " +
    "Use when the user asks to see their OneDrive files, find a document, " +
    "or check what's in their Microsoft OneDrive. " +
    "Supports keyword search and folder browsing.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search keyword query (optional). Searches file names and content.",
      },
      folder_path: {
        type: "string",
        description:
          "List files in a specific folder by path (optional, defaults to root). " +
          "Example: '/Documents/Reports'.",
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
    const folderPath = args.folder_path as string | undefined;
    const maxResults = Math.min((args.max_results as number) || 20, 50);

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      let url: string;

      if (query) {
        // Use search endpoint
        const params = new URLSearchParams({
          $top: String(maxResults),
          $select: "id,name,size,lastModifiedDateTime,webUrl,file,folder",
        });
        url = `${GRAPH_API}/drive/root/search(q='${encodeURIComponent(query)}')?${params.toString()}`;
      } else {
        // List folder children
        let basePath: string;
        if (folderPath && folderPath !== "/") {
          const cleanFolder = folderPath.replace(/^\/|\/$/g, "");
          basePath = `${GRAPH_API}/drive/root:/${encodeURIComponent(cleanFolder)}:/children`;
        } else {
          basePath = `${GRAPH_API}/drive/root/children`;
        }
        const params = new URLSearchParams({
          $top: String(maxResults),
          $select: "id,name,size,lastModifiedDateTime,webUrl,file,folder",
          $orderby: "lastModifiedDateTime desc",
        });
        url = `${basePath}?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `OneDrive list failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        value?: Array<{
          id: string;
          name: string;
          size?: number;
          lastModifiedDateTime?: string;
          webUrl?: string;
          file?: { mimeType?: string };
          folder?: { childCount?: number };
        }>;
        "@odata.nextLink"?: string;
      };

      const files = (data.value || []).map((f) => ({
        id: f.id,
        name: f.name,
        isFolder: !!f.folder,
        mimeType: f.file?.mimeType,
        size: f.size ? formatFileSize(f.size) : undefined,
        lastModified: f.lastModifiedDateTime,
        webUrl: f.webUrl,
        childCount: f.folder?.childCount,
      }));

      return {
        success: true,
        data: {
          files,
          resultCount: files.length,
          hasMore: !!data["@odata.nextLink"],
          message:
            files.length > 0
              ? `Found ${files.length} item(s) in OneDrive.`
              : "No files found in OneDrive matching the criteria.",
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
// onedrive_read — Read/download content from a OneDrive file
// ---------------------------------------------------------------------------

/** Max bytes we'll return to the model to avoid context blowup (~100 KB). */
const MAX_READ_BYTES = 100_000;

export const onedriveRead = createTool({
  name: "onedrive_read",
  description:
    "Read the content of a file from OneDrive. " +
    "Use when the user asks to read, review, summarize, or analyze a OneDrive file. " +
    "Text-based files (txt, csv, json, md, etc.) are downloaded and returned directly. " +
    "Binary files (images, PDFs, etc.) return metadata only. " +
    "Requires the file ID, which can be obtained from onedrive_list.",
  parameters: {
    type: "object",
    properties: {
      file_id: {
        type: "string",
        description: "OneDrive file ID (from onedrive_list results).",
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
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // Step 1: Get file metadata
      const metaResponse = await fetch(
        `${GRAPH_API}/drive/items/${encodeURIComponent(fileId)}?$select=id,name,size,webUrl,file`,
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
        size?: number;
        webUrl?: string;
        file?: { mimeType?: string };
      };

      const mimeType = meta.file?.mimeType || "application/octet-stream";

      // Step 2: Check if text-readable
      if (!isTextMimeType(mimeType)) {
        return {
          success: true,
          data: {
            fileId: meta.id,
            name: meta.name,
            mimeType,
            size: meta.size ? formatFileSize(meta.size) : "unknown",
            webUrl: meta.webUrl,
            content: null,
            message:
              `"${meta.name}" is a binary file (${mimeType}) and cannot be read as text. ` +
              (meta.webUrl
                ? `[Open in OneDrive](${meta.webUrl})`
                : `File ID: ${meta.id}`),
          },
        };
      }

      // Step 3: Download content
      const downloadResponse = await fetch(
        `${GRAPH_API}/drive/items/${encodeURIComponent(fileId)}/content`,
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

      let content = await downloadResponse.text();

      // Step 4: Truncate if too large
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
          mimeType,
          content,
          truncated,
          characterCount: content.length,
          message: truncated
            ? `Read first ${MAX_READ_BYTES.toLocaleString()} characters of "${meta.name}" (file was truncated).`
            : `Read "${meta.name}" (${content.length.toLocaleString()} characters).`,
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
// Helpers
// ---------------------------------------------------------------------------

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// onedrive_move — Move a file/folder to a different location in OneDrive
// ---------------------------------------------------------------------------

export const onedriveMove = createTool({
  name: "onedrive_move",
  description:
    "Move a file or folder to a different location in the user's OneDrive. " +
    "Use when the user asks to move a file into a folder, organize their OneDrive, " +
    "or file a document into a specific location. " +
    "Requires the item ID (from onedrive_list) and a destination. " +
    "You can specify the destination as a folder ID or a folder path. " +
    "Optionally rename the file during the move by providing a new name.",
  parameters: {
    type: "object",
    properties: {
      item_id: {
        type: "string",
        description: "OneDrive item ID to move (from onedrive_list results).",
      },
      destination_folder_id: {
        type: "string",
        description:
          "Destination folder ID (from onedrive_list results). " +
          "Use 'root' for the top-level of OneDrive. " +
          "Either destination_folder_id or destination_folder_path is required.",
      },
      destination_folder_path: {
        type: "string",
        description:
          "Destination folder path (e.g. '/Documents/Reports'). " +
          "Alternative to destination_folder_id. " +
          "Either destination_folder_id or destination_folder_path is required.",
      },
      new_name: {
        type: "string",
        description:
          "New filename for the item (optional). If omitted, the item keeps its current name.",
      },
    },
    required: ["item_id"],
  },

  execute: async (toolCtx, args) => {
    const itemId = args.item_id as string;
    const destFolderId = args.destination_folder_id as string | undefined;
    const destFolderPath = args.destination_folder_path as string | undefined;
    const newName = args.new_name as string | undefined;

    if (!itemId) {
      return {
        success: false,
        data: null,
        error: "Missing required field: 'item_id'.",
      };
    }

    if (!destFolderId && !destFolderPath) {
      return {
        success: false,
        data: null,
        error: "Either 'destination_folder_id' or 'destination_folder_path' is required.",
      };
    }

    try {
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // Build the PATCH body
      const body: Record<string, unknown> = {};

      if (destFolderId) {
        if (destFolderId === "root") {
          body.parentReference = { path: "/drive/root:" };
        } else {
          body.parentReference = { id: destFolderId };
        }
      } else if (destFolderPath) {
        const cleanPath = destFolderPath.replace(/^\/|\/$/g, "");
        body.parentReference = { path: `/drive/root:/${cleanPath}` };
      }

      if (newName) {
        body.name = newName;
      }

      const response = await fetch(
        `${GRAPH_API}/drive/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `OneDrive move failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        id: string;
        name: string;
        webUrl?: string;
        parentReference?: { path?: string };
      };

      const destination = destFolderPath || destFolderId || "unknown";

      return {
        success: true,
        data: {
          itemId: result.id,
          name: result.name,
          newLocation: result.parentReference?.path,
          webUrl: result.webUrl,
          message: `Moved "${result.name}" to ${destination}.` +
            (result.webUrl ? ` [Open in OneDrive](${result.webUrl})` : ""),
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
