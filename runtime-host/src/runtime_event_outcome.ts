import type { RuntimeCommand, RuntimeEvent } from "./control_plane.ts";

export type AttemptOutcome = "completed" | "failed" | "cancelled" | "interrupted";

export function isTurnCommand(command: RuntimeCommand): boolean {
  return command.kind === "start" || command.kind === "resume";
}

export function isStreamingText(event: RuntimeEvent): boolean {
  if (event.kind !== "worker_message" || typeof event.payload !== "object"
    || event.payload === null || !("kind" in event.payload)
    || event.payload.kind !== "adapter_event" || !("payload" in event.payload)) return false;
  const payload = event.payload.payload;
  if (typeof payload !== "object" || payload === null || !("event" in payload)) return false;
  const adapter = payload.event;
  return typeof adapter === "object" && adapter !== null && "type" in adapter
    && (adapter.type === "text_delta" || adapter.type === "reasoning_delta"
      || (adapter.type === "native_agent_activity" && "kind" in adapter
        && (adapter.kind === "message" || adapter.kind === "reasoning")));
}

export function eventOutcome(event: RuntimeEvent): AttemptOutcome | null {
  if (event.kind !== "worker_message" || typeof event.payload !== "object"
    || event.payload === null || !("kind" in event.payload)
    || event.payload.kind !== "terminal_event" || !("payload" in event.payload)) return null;
  const payload = event.payload.payload;
  if (typeof payload !== "object" || payload === null || !("event" in payload)) return null;
  const terminal = payload.event;
  if (typeof terminal !== "object" || terminal === null || !("outcome" in terminal)) return null;
  const outcome = terminal.outcome;
  return outcome === "completed" || outcome === "failed" || outcome === "cancelled"
    || outcome === "interrupted" ? outcome : null;
}
