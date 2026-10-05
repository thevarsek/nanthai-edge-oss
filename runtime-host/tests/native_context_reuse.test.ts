import assert from "node:assert/strict";
import test from "node:test";
import { undeliveredPacket } from "../src/native_context_reuse.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";
import { computePacketHash } from "../src/packet_integrity.ts";

test("catch-up preserves every skipped human and peer contribution exactly once", () => {
  const packet = runtimePacket();
  const source = packet.messages[0]!;
  packet.messages = [...["old-user", "skipped-user", "skipped-peer"].map((id, ordinal) => ({
    ...source, ordinal, messageId: id, role: id === "skipped-peer" ? "assistant" as const : "user" as const,
    participantId: id === "skipped-peer" ? "peer" : null,
    content: [{ type: "text" as const, partId: id, text: "Repeated wording still has distinct identity" }],
  })), { ...source, ordinal: 3 }];
  const catchup = undeliveredPacket(packet, ["old-user"]);
  assert.deepEqual(catchup.messages.map((message) => message.messageId), ["skipped-user", "skipped-peer", "message-1"]);
  assert.equal(catchup.messages[1]!.participantId, "peer");
  assert.equal(catchup.command.packetHash, computePacketHash(catchup));
  const continuation = undeliveredPacket(packet, ["old-user", "message-1"]);
  assert.equal(continuation.messages.length, 3);
  assert.doesNotMatch(JSON.stringify(continuation.messages.at(-1)), /Hello from NanthAI/);
});
