import { readFixedSizeChunks } from "../storage_upload_stream";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";
const SIMPLE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

export interface OneDriveUploadResult {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  file?: { mimeType?: string };
}

function completedDriveItem(value: unknown): OneDriveUploadResult {
  const item = value as Partial<OneDriveUploadResult> | null;
  if (!item || typeof item.id !== "string" || !item.id.trim()
    || typeof item.name !== "string" || !item.name.trim()) {
    throw new Error("OneDrive completed an upload without a file identifier.");
  }
  return item as OneDriveUploadResult;
}

function itemPath(folderPath: string, filename: string): string {
  const folder = folderPath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return folder ? `${folder}/${encodeURIComponent(filename)}` : encodeURIComponent(filename);
}

function checkedUploadUrl(value: string | undefined): URL {
  if (!value) throw new Error("OneDrive returned no upload URL.");
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const allowed = url.protocol === "https:" && (
    hostname.endsWith(".1drv.com") ||
    hostname.endsWith(".sharepoint.com") ||
    hostname.endsWith(".microsoft.com") ||
    hostname.endsWith(".office.com") ||
    hostname.endsWith(".office365.com")
  );
  if (!allowed || url.username || url.password || url.hash) {
    throw new Error("OneDrive returned an invalid upload URL.");
  }
  return url;
}

async function simpleUpload(args: {
  accessToken: string;
  response: Response;
  path: string;
}): Promise<OneDriveUploadResult> {
  const upload = await fetch(`${GRAPH_API}/drive/root:/${args.path}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: await args.response.arrayBuffer(),
  });
  if (!upload.ok) {
    await upload.body?.cancel();
    throw new Error(`OneDrive upload failed (HTTP ${upload.status}).`);
  }
  return completedDriveItem(await upload.json());
}

async function resumableUpload(args: {
  accessToken: string;
  response: Response;
  sizeBytes: number;
  path: string;
  filename: string;
}): Promise<OneDriveUploadResult> {
  const session = await fetch(
    `${GRAPH_API}/drive/root:/${args.path}:/createUploadSession`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item: {
          "@microsoft.graph.conflictBehavior": "replace",
          name: args.filename,
        },
      }),
    },
  );
  if (!session.ok) {
    await session.body?.cancel();
    throw new Error(`OneDrive upload session creation failed (HTTP ${session.status}).`);
  }
  const payload = await session.json() as { uploadUrl?: string };
  const uploadUrl = checkedUploadUrl(payload.uploadUrl);

  let offset = 0;
  for await (const chunk of readFixedSizeChunks(args.response, UPLOAD_CHUNK_BYTES)) {
    const endExclusive = offset + chunk.length;
    if (endExclusive > args.sizeBytes) {
      await args.response.body?.cancel().catch(() => undefined);
      throw new Error("OneDrive upload read more file bytes than expected.");
    }
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${endExclusive - 1}/${args.sizeBytes}`,
      },
      body: new Uint8Array(chunk),
      redirect: "error",
    });
    const isFinal = endExclusive === args.sizeBytes;
    if ((!isFinal && upload.status !== 202)
      || (isFinal && upload.status !== 200 && upload.status !== 201)) {
      await upload.body?.cancel();
      throw new Error(`OneDrive chunk upload failed (HTTP ${upload.status}).`);
    }
    if (isFinal) return completedDriveItem(await upload.json());
    const progress = await upload.json() as { nextExpectedRanges?: string[] };
    const nextOffset = Number.parseInt(progress.nextExpectedRanges?.[0] ?? "", 10);
    if (!Number.isSafeInteger(nextOffset) || nextOffset !== endExclusive) {
      throw new Error("OneDrive returned an invalid next upload range.");
    }
    offset = nextOffset;
  }
  throw new Error("OneDrive upload ended before all file bytes were read.");
}

export async function uploadOneDriveFile(args: {
  accessToken: string;
  response: Response;
  sizeBytes: number;
  folderPath: string;
  filename: string;
}): Promise<OneDriveUploadResult> {
  const path = itemPath(args.folderPath, args.filename);
  if (args.sizeBytes <= SIMPLE_UPLOAD_LIMIT_BYTES) {
    return await simpleUpload({
      accessToken: args.accessToken,
      response: args.response,
      path,
    });
  }
  return await resumableUpload({ ...args, path });
}
