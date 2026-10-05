import {
  AdapterEventSchema,
  type AdapterEvent,
  type LocalRuntimeTurnPacket,
} from "./protocol.ts";

export class CanonicalEventFactory {
  private sequence = 0;

  constructor(
    private readonly packet: LocalRuntimeTurnPacket,
    private readonly sessionId: string,
    private readonly now: () => number = Date.now,
    private readonly eventId: (sequence: number) => string = (sequence) =>
      `${sessionId}-event-${sequence}`,
  ) {}

  create(fields: Record<string, unknown>): AdapterEvent {
    const sequence = this.sequence++;
    return AdapterEventSchema.parse({
      protocolVersion: "nanthai.runtime.v1",
      eventId: this.eventId(sequence),
      sequence,
      occurredAt: this.now(),
      runId: this.packet.runId,
      attemptId: this.packet.attemptId,
      fence: this.packet.fence,
      sessionId: this.sessionId,
      ...fields,
    });
  }
}
