import { readFixedSizeChunks } from "../storage_upload_stream";

const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const MULTIPART_LIMIT_BYTES = 5 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const RESULT_FIELDS = "id,name,mimeType,webViewLink,size";

export interface DriveUploadResult {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  size?: string;
}

function checkedSessionUrl(value: string | null): URL {
  if (!value) throw new Error("Drive returned no resumable upload URL.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.googleapis.com" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Drive returned an invalid resumable upload URL.");
  }
  return url;
}

function acknowledgedDriveOffset(
  range: string | null,
  previousOffset: number,
  submittedEndExclusive: number,
): number {
  const match = range?.match(/^bytes=0-(\d+)$/i);
  const acknowledged = match ? Number(match[1]) + 1 : 0;
  if (
    !Number.isSafeInteger(acknowledged) || acknowledged <= previousOffset ||
    acknowledged > submittedEndExclusive
  ) {
    throw new Error("Drive resumable upload made no valid progress.");
  }
  return acknowledged;
}

async function uploadMultipart(args: {
  accessToken: string;
  response: Response;
  metadata: Record<string, unknown>;
  mimeType: string;
}): Promise<DriveUploadResult> {
  const boundary = "nanthai_drive_upload_boundary";
  const encoder = new TextEncoder();
  const fileBytes = new Uint8Array(await args.response.arrayBuffer());
  const parts = [
    encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(args.metadata)}\r\n`,
    ),
    encoder.encode(`--${boundary}\r\nContent-Type: ${args.mimeType}\r\n\r\n`),
    fileBytes,
    encoder.encode(`\r\n--${boundary}--`),
  ];
  const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  const upload = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${RESULT_FIELDS}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!upload.ok) {
    await upload.body?.cancel();
    throw new Error(`Drive upload failed (HTTP ${upload.status}).`);
  }
  return await upload.json() as DriveUploadResult;
}

async function uploadResumable(args: {
  accessToken: string;
  response: Response;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  mimeType: string;
}): Promise<DriveUploadResult> {
  const session = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${RESULT_FIELDS}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(args.sizeBytes),
        "X-Upload-Content-Type": args.mimeType,
      },
      body: JSON.stringify(args.metadata),
    },
  );
  if (!session.ok) {
    await session.body?.cancel();
    throw new Error(`Drive upload session creation failed (HTTP ${session.status}).`);
  }
  const uploadUrl = checkedSessionUrl(session.headers.get("location"));
  await session.body?.cancel();

  let offset = 0;
  for await (const chunk of readFixedSizeChunks(args.response, UPLOAD_CHUNK_BYTES)) {
    const chunkStart = offset;
    const chunkEndExclusive = chunkStart + chunk.length;
    if (chunkEndExclusive > args.sizeBytes) {
      await args.response.body?.cancel().catch(() => undefined);
      throw new Error("Drive upload read more file bytes than expected.");
    }
    while (offset < chunkEndExclusive) {
      const remaining = chunk.subarray(offset - chunkStart);
      const isFinal = chunkEndExclusive === args.sizeBytes;
      const upload = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(remaining.length),
          "Content-Range": `bytes ${offset}-${chunkEndExclusive - 1}/${args.sizeBytes}`,
        },
        body: new Uint8Array(remaining),
        redirect: "error",
      });
      if (upload.status === 308) {
        const nextOffset = acknowledgedDriveOffset(
          upload.headers.get("range"),
          offset,
          chunkEndExclusive,
        );
        await upload.body?.cancel();
        offset = nextOffset;
        continue;
      }
      if (!isFinal || !upload.ok) {
        await upload.body?.cancel();
        throw new Error(`Drive chunk upload failed (HTTP ${upload.status}).`);
      }
      return await upload.json() as DriveUploadResult;
    }
  }
  throw new Error("Drive upload ended before all file bytes were read.");
}

export async function uploadDriveFile(args: {
  accessToken: string;
  response: Response;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  mimeType: string;
}): Promise<DriveUploadResult> {
  if (args.sizeBytes <= MULTIPART_LIMIT_BYTES) {
    return await uploadMultipart(args);
  }
  return await uploadResumable(args);
}
