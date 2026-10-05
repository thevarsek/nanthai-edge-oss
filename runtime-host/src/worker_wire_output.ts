import {
  PROCESS_WIRE_VERSION,
  WorkerToHostMessageSchema,
  type WorkerToHostMessage,
} from "./protocol.ts";

type WorkerPayload = WorkerToHostMessage extends infer Message
  ? Message extends WorkerToHostMessage
    ? Pick<Message, "kind" | "payload">
    : never
  : never;

export class WorkerWireOutput {
  private sequence = 0;

  constructor(
    private readonly workerId: string,
    private readonly emitLine: (line: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  emit(message: WorkerPayload): WorkerToHostMessage {
    const sequence = this.sequence++;
    const parsed = WorkerToHostMessageSchema.parse({
      wireVersion: PROCESS_WIRE_VERSION,
      messageId: `${this.workerId}-output-${sequence}`,
      sequence,
      sentAt: this.now(),
      ...message,
    });
    this.emitLine(JSON.stringify(parsed));
    return parsed;
  }
}
