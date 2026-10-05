import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { OfflineImportSchema } from "./offline_import_contract";
import { contextDigest } from "./context_receipt";
import { jsonResponse, parseJson, runtimeHostHeaders, withRuntimeHttpErrors } from "./http_common";
const authorize = makeFunctionReference<"mutation">("runtime_host/offline_import:authorize");
const importResult = makeFunctionReference<"mutation">("runtime_host/offline_import:importResult");

export async function importOfflineHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  return withRuntimeHttpErrors(async () => {
    const { presenceSessionId: _presence, ...authority } = runtimeHostHeaders(request);
    const body = await parseJson(request, OfflineImportSchema);
    const originRunId = body.originRunId as Id<"executionRuns">;
    await ctx.runMutation(authorize, { ...authority, originRunId });
    const files: Array<{ storageId: Id<"_storage">; filename: string; mimeType: string; sizeBytes: number }> = [];
    try {
      for (const file of body.files) {
        const blob = new Blob([file.content], { type: file.mimeType });
        files.push({ storageId: await ctx.storage.store(blob), filename: file.filename, mimeType: file.mimeType, sizeBytes: blob.size });
      }
      const { usage, files: _files, ...result } = body;
      const receipt = await ctx.runMutation(importResult, {
        ...authority, ...result, originRunId, inputHash: await contextDigest(body), files, usageJson: JSON.stringify(usage),
      });
      return jsonResponse(receipt);
    } catch (error) {
      if (error instanceof ConvexError) for (const file of files) await ctx.storage.delete(file.storageId);
      throw error; // Ambiguous transport commits retain uploaded bytes and reconcile by result identity.
    }
  });
}
