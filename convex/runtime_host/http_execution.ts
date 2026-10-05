import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
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

const heartbeatAttemptRef = publicRef<"mutation", CredentialArgs & {
  attemptId: Id<"executionAttempts">;
  fence: number;
}, number>("runtime_host/host_execution:heartbeatAttempt");
const settleAttemptRef = publicRef<"mutation", CredentialArgs & {
  attemptId: Id<"executionAttempts">;
  fence: number;
  outcome: "completed" | "failed" | "cancelled" | "interrupted";
  summary?: string;
}, null>("runtime_host/host_execution:settleAttempt");

const attemptSchema = z.object({
  attemptId: z.string().min(1),
  fence: z.number().int().positive(),
});
const settleSchema = attemptSchema.extend({
  outcome: z.enum(["completed", "failed", "cancelled", "interrupted"]),
  summary: z.string().min(1).max(2_000).optional(),
});

export async function heartbeatAttemptHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, attemptSchema);
    const leaseExpiresAt = await ctx.runMutation(heartbeatAttemptRef, {
      ...host,
      attemptId: body.attemptId as Id<"executionAttempts">,
      fence: body.fence,
    });
    return jsonResponse({ leaseExpiresAt });
  });
}

export async function settleAttemptHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, settleSchema);
    await ctx.runMutation(settleAttemptRef, {
      ...host,
      attemptId: body.attemptId as Id<"executionAttempts">,
      fence: body.fence,
      outcome: body.outcome,
      ...(body.summary === undefined ? {} : { summary: body.summary }),
    });
    return jsonResponse({ settled: true });
  });
}
