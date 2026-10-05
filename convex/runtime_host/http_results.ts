import { ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
import { PublishResultSchema } from "./bridge_contract";
import { contextDigest } from "./context_receipt";
import { jsonResponse, parseJson, runtimeHostHeaders, withRuntimeHttpErrors } from "./http_common";

const bodySchema = PublishResultSchema.extend({ attemptId: z.string().min(1), fence: z.number().int().positive(), callId: z.string().min(1).max(256) });
const authorize = makeFunctionReference<"mutation">("runtime_host/result_publication:authorize");
const publish = makeFunctionReference<"mutation">("runtime_host/result_publication:publish");
export async function publishResultHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  return withRuntimeHttpErrors(async () => {
    const credentials = runtimeHostHeaders(request);
    const body = await parseJson(request, bodySchema);
    const authority = { ...credentials, attemptId: body.attemptId as Id<"executionAttempts">, fence: body.fence };
    await ctx.runMutation(authorize, authority);
    const file = PublishResultSchema.parse({ filename: body.filename, mimeType: body.mimeType, content: body.content });
    const blob = new Blob([file.content], { type: file.mimeType });
    const storageId = await ctx.storage.store(blob);
    let result;
    try {
      result = await ctx.runMutation(publish, {
      ...authority, callId: body.callId, inputHash: await contextDigest(file), storageId,
      filename: file.filename, mimeType: file.mimeType, sizeBytes: blob.size, content: file.content,
      });
    } catch (error) {
      // A structured server rejection proves the mutation aborted. Keep bytes on
      // transport ambiguity: the commit may have succeeded and retry reconciles it.
      if (error instanceof ConvexError) await ctx.storage.delete(storageId);
      throw error;
    }
    return jsonResponse({ ...result, url: await ctx.storage.getUrl(result.storageId) });
  });
}
