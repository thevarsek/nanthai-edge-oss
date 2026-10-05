import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { jsonResponse, parseJson, publicRef, runtimeDeviceHeaders, withRuntimeHttpErrors } from "./http_common";
import type { UsageHistoryArgs, UsageHistoryPage } from "./usage_history";
const bodySchema = z.strictObject({ cursor: z.string().nullable(), throughMs: z.number().int().nonnegative().optional() });
const usageRef = publicRef<"query", UsageHistoryArgs, UsageHistoryPage>("runtime_host/usage_history:listForHost");
export async function usageHistoryHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  return withRuntimeHttpErrors(async () => {
    const credentials = runtimeDeviceHeaders(request);
    const body = await parseJson(request, bodySchema);
    return jsonResponse(await ctx.runQuery(usageRef, { ...credentials, ...body }));
  });
}
