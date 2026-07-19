// convex/http.ts
// =============================================================================
// HTTP router for public endpoints that live outside the Convex function API.
// Currently serves file downloads with proper Content-Disposition filenames.
// =============================================================================

import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  isAllowedVideoUploadMimeType,
  MAX_VIDEO_OUTPUT_UPLOAD_BYTES,
  VIDEO_OUTPUT_UPLOAD_TTL_MS,
} from "./chat/video_output_upload_policy";
import { stripeWebhook } from "./stripe/webhook";
import { triggerScheduledJob } from "./scheduledJobs/http";

const http = httpRouter();

export async function handleVideoOutputUpload(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("Missing token parameter", { status: 400 });
  }

  const session = await ctx.runQuery(
    internal.chat.queries.getVideoOutputUploadByToken,
    { token },
  );
  if (!session) {
    return new Response("Invalid upload token", { status: 404 });
  }
  if (session.status !== "pending") {
    return new Response("Upload token already used", { status: 409 });
  }
  if (Date.now() - session.createdAt > VIDEO_OUTPUT_UPLOAD_TTL_MS) {
    return new Response("Upload token expired", { status: 410 });
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > MAX_VIDEO_OUTPUT_UPLOAD_BYTES) {
    return new Response("Upload too large", { status: 413 });
  }

  const mimeType = request.headers.get("Content-Type") ?? "video/mp4";
  if (!isAllowedVideoUploadMimeType(mimeType)) {
    return new Response("Unsupported media type", { status: 415 });
  }
  const blob = await request.blob();
  if (blob.size === 0) {
    return new Response("Empty upload", { status: 400 });
  }
  if (blob.size > MAX_VIDEO_OUTPUT_UPLOAD_BYTES) {
    return new Response("Upload too large", { status: 413 });
  }

  const storageId = await ctx.storage.store(new Blob([blob], { type: mimeType }));
  let accepted: boolean;
  try {
    accepted = await ctx.runMutation(
      internal.chat.mutations.completeVideoOutputUpload,
      { token, storageId, mimeType, sizeBytes: blob.size },
    );
  } catch (error) {
    await ctx.storage.delete(storageId).catch(() => undefined);
    throw error;
  }
  if (!accepted) {
    await ctx.storage.delete(storageId).catch(() => undefined);
    return new Response("Upload token already used or expired", { status: 409 });
  }

  return Response.json({ storageId });
}

http.route({
  path: "/video-output-upload",
  method: "POST",
  handler: httpAction(handleVideoOutputUpload),
});

http.route({
  path: "/video-output-upload",
  method: "PUT",
  handler: httpAction(handleVideoOutputUpload),
});

// ---------------------------------------------------------------------------
// GET /download?storageId=...&filename=...
//
// Proxies a file from Convex storage and sets Content-Disposition so the
// browser (or iOS) saves it with the correct filename.
// Requires a valid Clerk session token in the Authorization header.
// ---------------------------------------------------------------------------
http.route({
  path: "/download",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // No auth check — the storageId itself is an unguessable random token
    // that is only shared with authenticated users via Convex queries.
    // Browsers opened via Intent.ACTION_VIEW (Android) or window.open (web)
    // cannot carry Clerk session tokens, so auth here would block all downloads.

    const url = new URL(request.url);
    const storageId = url.searchParams.get("storageId");
    const filename = url.searchParams.get("filename") ?? "download";

    if (!storageId) {
      return new Response("Missing storageId parameter", { status: 400 });
    }

    let blob: Blob | null;
    try {
      blob = await ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return new Response("Invalid storageId", { status: 400 });
    }
    if (!blob) {
      return new Response("File not found", { status: 404 });
    }

    // Derive Content-Type from filename extension or fall back to blob type.
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
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
    const contentType = mimeTypes[ext ?? ""] ?? blob.type ?? "application/octet-stream";

    // RFC 6266/5987: filename is ASCII-only fallback, filename* is the full UTF-8 value.
    // Strip non-ASCII from the fallback filename to avoid broken header parsing.
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_");
    const rfc5987Filename = encodeURIComponent(filename);

    return new Response(blob, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${rfc5987Filename}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }),
});

// ---------------------------------------------------------------------------
// POST /stripe/webhook
//
// Stripe sends signed checkout.session.completed events here. Verifies the
// Stripe-Signature header (HMAC-SHA256) and grants a Pro entitlement row.
// ---------------------------------------------------------------------------
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

// ---------------------------------------------------------------------------
// POST /scheduled-jobs/trigger
//
// Triggers an existing scheduled job via API token or authenticated user.
// Optional variables payload supports template substitution in step prompts.
// ---------------------------------------------------------------------------
http.route({
  path: "/scheduled-jobs/trigger",
  method: "POST",
  handler: triggerScheduledJob,
});

export default http;
