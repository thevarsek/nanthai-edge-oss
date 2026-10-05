import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
import {
  FenceSchema,
  IdentifierSchema,
  TimestampSchema,
} from "./protocol_common";
import { WorkerToHostMessageSchema } from "./protocol_process";
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

type RuntimeEventInput = {
  eventId: string;
  commandRecordId: Id<"runtimeCommands">;
  commandId: string;
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  kind: "worker_message" | "host_command_failed";
  emittedAtMs: number;
  payload: unknown;
};

const ingestRuntimeEventsRef = publicRef<"mutation", CredentialArgs & {
  events: RuntimeEventInput[];
}, string[]>("runtime_host/chat_event_ingestion:ingestRuntimeEvents");

const runtimeEventBase = {
  eventId: IdentifierSchema,
  commandRecordId: IdentifierSchema,
  commandId: IdentifierSchema,
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  fence: FenceSchema,
  emittedAtMs: TimestampSchema,
};
const runtimeEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...runtimeEventBase,
    kind: z.literal("worker_message"),
    payload: WorkerToHostMessageSchema,
  }),
  z.strictObject({
    ...runtimeEventBase,
    kind: z.literal("host_command_failed"),
    payload: z.strictObject({ message: z.string().min(1).max(2_000) }),
  }),
]);
const eventBatchSchema = z.strictObject({
  events: z.array(runtimeEventSchema).min(1).max(100),
});

export async function publishRuntimeEventsHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, eventBatchSchema);
    const acceptedEventIds = await ctx.runMutation(ingestRuntimeEventsRef, {
      ...host,
      events: body.events.map((event) => ({
        ...event,
        commandRecordId: event.commandRecordId as Id<"runtimeCommands">,
        runId: event.runId as Id<"executionRuns">,
        attemptId: event.attemptId as Id<"executionAttempts">,
      })),
    });
    return jsonResponse({ acceptedEventIds });
  });
}
