import { createHash } from "node:crypto";

import {
  HostToWorkerMessageSchema,
  PROCESS_WIRE_VERSION,
  type HostToWorkerMessage,
} from "./protocol.ts";

export class HostWireSequencer {
  private sequence = 0;

  constructor(private readonly now: () => number = Date.now) {}

  next(
    commandRecordId: string,
    value: HostMessageBody,
  ): HostToWorkerMessage {
    const sequence = this.sequence;
    this.sequence += 1;
    return HostToWorkerMessageSchema.parse({
      wireVersion: PROCESS_WIRE_VERSION,
      messageId: messageId(commandRecordId, value.kind, sequence),
      sequence,
      sentAt: this.now(),
      kind: value.kind,
      payload: value.payload,
    });
  }
}

export type HostMessageBody = HostToWorkerMessage extends infer Message
  ? Message extends HostToWorkerMessage
    ? Pick<Message, "kind" | "payload">
    : never
  : never;

function messageId(commandRecordId: string, kind: string, sequence: number): string {
  const digest = createHash("sha256")
    .update(`${commandRecordId}:${kind}:${sequence}`)
    .digest("hex")
    .slice(0, 24);
  return `host-${sequence}-${digest}`;
}
