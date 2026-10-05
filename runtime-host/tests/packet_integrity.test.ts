import assert from "node:assert/strict";
import test from "node:test";

import {
  computePacketHash,
  PacketIntegrityError,
  verifyPacketIntegrity,
} from "../src/packet_integrity.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

test("verifies the known canonical packet digest", () => {
  const packet = runtimePacket();
  assert.equal(packet.command.packetHash, computePacketHash(packet));
  assert.deepEqual(verifyPacketIntegrity(packet), packet);
});

test("rejects a schema-valid packet changed after hashing", () => {
  const packet = runtimePacket();
  const tampered = {
    ...packet,
    messages: packet.messages.map((message, index) => index === 0
      ? {
        ...message,
        content: message.content.map((part, partIndex) =>
          partIndex === 0 && part.type === "text"
            ? { ...part, text: "tampered after assembly" }
            : part),
      }
      : message),
  };
  assert.throws(
    () => verifyPacketIntegrity(tampered),
    (error) => error instanceof PacketIntegrityError,
  );
});

test("object key order does not affect the canonical digest", () => {
  const packet = runtimePacket();
  const reordered = JSON.parse(JSON.stringify(packet)) as typeof packet;
  reordered.command = {
    cancellationId: packet.command.cancellationId,
    packetHash: packet.command.packetHash,
    commandInputHash: packet.command.commandInputHash,
    idempotencyKey: packet.command.idempotencyKey,
    commandId: packet.command.commandId,
  };
  assert.equal(computePacketHash(reordered), packet.command.packetHash);
});
