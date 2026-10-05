import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
import { RUNTIME_LIMITS } from "./protocol_common";
import {
  jsonResponse,
  parseJson,
  publicRef,
  runtimeHostHeaders,
  withRuntimeHttpErrors,
} from "./http_common";

type CredentialArgs = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
};

type FetchGrant = {
  storageId: Id<"_storage">;
  mimeType: string;
  byteLength: number;
  maxChunkBytes: number;
  sha256: string;
  expiresAt: number;
};

const attachmentRef = publicRef<
  "query",
  CredentialArgs & { handle: string },
  FetchGrant | null
>("runtime_host/attachment_fetch_handles:getForHost");

const fetchBodySchema = z.strictObject({
  handle: z.string().min(1).max(2_048),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxBytes: z.number().int().positive().max(RUNTIME_LIMITS.maxChunkBytes),
});

export async function fetchRuntimeAttachmentHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, fetchBodySchema);
    const grant = await ctx.runQuery(attachmentRef, {
      ...host,
      handle: body.handle,
    });
    if (!grant) {
      return jsonResponse({
        error: { code: "NOT_FOUND", message: "Runtime attachment is unavailable" },
      }, 404);
    }
    if (body.offset >= grant.byteLength || body.maxBytes > grant.maxChunkBytes) {
      return jsonResponse({
        error: {
          code: "RUNTIME_ATTACHMENT_RANGE_INVALID",
          message: "Runtime attachment range is outside the authorized bounds",
        },
      }, 416);
    }
    const blob = await ctx.storage.get(grant.storageId);
    if (
      !blob
      || blob.size !== grant.byteLength
      || blob.type.toLowerCase() !== grant.mimeType
    ) {
      return jsonResponse({
        error: {
          code: "RUNTIME_ATTACHMENT_INVALID",
          message: "Runtime attachment storage does not match its manifest",
        },
      }, 409);
    }
    const endExclusive = Math.min(grant.byteLength, body.offset + body.maxBytes);
    const chunk = blob.slice(body.offset, endExclusive, grant.mimeType);
    const endInclusive = endExclusive - 1;
    return new Response(chunk, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(chunk.size),
        "Content-Range": `bytes ${body.offset}-${endInclusive}/${grant.byteLength}`,
        "Content-Type": grant.mimeType,
        ETag: `"${grant.sha256}"`,
        "X-NanthAI-Attachment-Byte-Length": String(grant.byteLength),
        "X-NanthAI-Attachment-Expires-At": String(grant.expiresAt),
        "X-NanthAI-Attachment-Offset": String(body.offset),
        "X-NanthAI-Attachment-SHA256": grant.sha256,
      },
    });
  });
}
