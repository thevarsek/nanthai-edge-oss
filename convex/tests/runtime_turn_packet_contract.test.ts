import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AdapterCapabilitiesSchema,
} from "../runtime_host/protocol_adapter";
import {
  buildLocalRuntimeTurnPacket,
  buildRuntimeTurnPacket,
  packetRequiredModalities,
  RuntimeContractValidationError,
} from "../runtime_host/packet_builder";
import {
  RuntimeTurnPacketSchema,
} from "../runtime_host/protocol_packet";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    new URL(`../../fixtures/m45/${name}`, import.meta.url),
    "utf8",
  ));
}

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected fixture object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected fixture array");
  return value;
}

const localInput = fixture("runtime-turn-local-v1.json");
const cloudInput = fixture("runtime-turn-cloud-bare-model-v1.json");
const capabilitiesInput = fixture("adapter-capabilities-v1.json");

test("local packet preserves role, name, order, every modality, and fetch handles", () => {
  const packet = buildLocalRuntimeTurnPacket(localInput, capabilitiesInput);
  assert.deepEqual(packet.messages.map((message) => [
    message.ordinal,
    message.role,
    message.name,
  ]), [
    [0, "assistant", "Architect"],
    [1, "user", "Dino"],
  ]);
  assert.deepEqual(packetRequiredModalities(packet), [
    "text",
    "image",
    "audio",
    "video",
    "document",
    "file",
    "tool_evidence",
  ]);
  const fetchedParts = packet.messages
    .flatMap((message) => message.content)
    .filter((part) => part.type !== "text");
  assert.equal(fetchedParts.length, 6);
  for (const part of fetchedParts) {
    assert.ok(part.fetch.handle.length > 0);
    assert.ok(part.fetch.maxChunkBytes <= 4 * 1024 * 1024);
    assert.match(part.fetch.sha256, /^[a-f0-9]{64}$/);
  }
});

test("the same packet contract accepts existing cloud bare-model participants", () => {
  const packet = buildRuntimeTurnPacket(cloudInput);
  assert.equal(packet.personaId, null);
  assert.equal(packet.placement.placement, "cloud");
  assert.equal(packet.placement.executorKind, "convex_workflow");
  assert.equal(packet.placement.selectedModel.modelId, "openai/gpt-5.6");
});

test("local placement rejects a missing Persona identity", () => {
  const changed = record(clone(localInput));
  changed.personaId = null;
  assert.equal(RuntimeTurnPacketSchema.safeParse(changed).success, false);
});

test("non-text parts cannot silently omit their authorized fetch handle", () => {
  const changed = record(clone(localInput));
  const messages = list(changed.messages);
  const content = list(record(messages[1]).content);
  delete record(content[1]).fetch;
  assert.throws(
    () => buildLocalRuntimeTurnPacket(changed, capabilitiesInput),
    (error) => error instanceof RuntimeContractValidationError
      && error.code === "INVALID_RUNTIME_TURN_PACKET",
  );
});

test("unsupported modalities fail preflight instead of being removed", () => {
  const capabilities = AdapterCapabilitiesSchema.parse(capabilitiesInput);
  const withoutVideo = {
    ...capabilities,
    inputModalities: capabilities.inputModalities
      .filter((modality) => modality !== "video"),
  };
  assert.throws(
    () => buildLocalRuntimeTurnPacket(localInput, withoutVideo),
    (error) => error instanceof RuntimeContractValidationError
      && error.code === "UNSUPPORTED_RUNTIME_MODALITY"
      && error.message.includes("video"),
  );
});

test("placement is immutable and cannot acquire an actual model", () => {
  const changed = record(clone(localInput));
  record(changed.placement).actualModel = {
    provider: "openai",
    modelId: "gpt-5.6-codex-mini",
  };
  assert.equal(RuntimeTurnPacketSchema.safeParse(changed).success, false);
});

test("packet references, ordinals, omission ledger, and unknown keys are strict", () => {
  const wrongOrdinal = record(clone(localInput));
  const ordinalMessages = list(wrongOrdinal.messages);
  record(ordinalMessages[1]).ordinal = 3;
  assert.equal(RuntimeTurnPacketSchema.safeParse(wrongOrdinal).success, false);

  const wrongOmissions = record(clone(localInput));
  record(wrongOmissions.context).omittedPartCount = 1;
  assert.equal(RuntimeTurnPacketSchema.safeParse(wrongOmissions).success, false);

  const missingHead = record(clone(localInput));
  record(missingHead.context).canonicalHeadMessageId = "message-not-in-packet";
  assert.throws(
    () => buildRuntimeTurnPacket(missingHead),
    (error) => error instanceof RuntimeContractValidationError
      && error.code === "INVALID_RUNTIME_TURN_PACKET",
  );

  const unknownKey = record(clone(localInput));
  unknownKey.unversionedExtension = true;
  assert.equal(RuntimeTurnPacketSchema.safeParse(unknownKey).success, false);
});
