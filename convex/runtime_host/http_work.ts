import { z } from "zod";
import { makeFunctionReference } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import { WorkResultSchema } from "./bridge_contract";
import { jsonResponse, parseJson, runtimeHostHeaders, withRuntimeHttpErrors } from "./http_common";

const bodySchema = WorkResultSchema.extend({ attemptId: z.string(), fence: z.number().int().positive(), callId: z.string() });
const publish = makeFunctionReference<"mutation">("runtime_host/work_publication:publish");
export async function publishWorkHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  return withRuntimeHttpErrors(async () => {
    const credentials = runtimeHostHeaders(request);
    const body = await parseJson(request, bodySchema);
    await ctx.runMutation(publish, { ...credentials, ...body });
    return jsonResponse({ committed: true });
  });
}
