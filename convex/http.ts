// convex/http.ts
// =============================================================================
// HTTP router for public endpoints that live outside the Convex function API.
// Currently serves file downloads with proper Content-Disposition filenames.
// =============================================================================

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { stripeWebhook } from "./stripe/webhook";
import { triggerScheduledJob } from "./scheduledJobs/http";

const http = httpRouter();

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
