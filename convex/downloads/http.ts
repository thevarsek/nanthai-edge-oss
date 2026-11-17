import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { downloadLinkSecret, legacyDownloadLinksUntil, verifyDownloadToken } from "./links";

const MIME_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  eml: "message/rfc822",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

type DownloadDeps = {
  env?: Record<string, string | undefined>;
  nowMs?: number;
};

/**
 * GET /download?t=<signed token>&filename=...
 *
 * Signed links are issued by Convex payloads and expire. The legacy
 * `?storageId=` form is accepted during the documented transition, and after
 * it only with a Clerk bearer token for a user who owns the file.
 */
export async function handleDownload(ctx: ActionCtx, request: Request, deps: DownloadDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const now = deps.nowMs ?? Date.now();
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename") ?? "download";
  const token = url.searchParams.get("t");
  let storageId: string | null;
  if (token) {
    const secret = downloadLinkSecret(env);
    if (!secret) return new Response("Download links are not configured", { status: 503 });
    const check = await verifyDownloadToken(token, secret, now);
    if (!check.ok) {
      return new Response(check.reason === "expired"
        ? "This download link has expired. Open the file again in NanthAI to get a new link."
        : "Invalid download link", { status: check.reason === "expired" ? 410 : 403 });
    }
    storageId = check.storageId;
  } else {
    storageId = url.searchParams.get("storageId");
    if (!storageId) return new Response("Missing download token", { status: 400 });
    const legacyAllowed = now < legacyDownloadLinksUntil(env);
    if (!legacyAllowed) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) return new Response("Sign in again to download this file", { status: 401 });
      const owned = await ctx.runQuery(internal.downloads.queries.ownsDownloadableStorage, { storageId });
      if (!owned) return new Response("File not found", { status: 404 });
    }
  }

  let blob: Blob | null;
  try {
    blob = await ctx.storage.get(storageId as Id<"_storage">);
  } catch {
    return new Response("Invalid storageId", { status: 400 });
  }
  if (!blob) return new Response("File not found", { status: 404 });

  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = MIME_TYPES[ext ?? ""] ?? blob.type ?? "application/octet-stream";
  // RFC 6266/5987: ASCII fallback plus the full UTF-8 value.
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const rfc5987Filename = encodeURIComponent(filename);
  return new Response(blob, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${rfc5987Filename}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
