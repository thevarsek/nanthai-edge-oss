import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_SERVER_CAPABILITIES,
} from "../src/codex_capabilities.ts";
import {
  PacketTranslationError,
  translateRuntimeTurnPacket,
} from "../src/packet_translation.ts";
import { RuntimeTurnPacketSchema } from "../src/protocol.ts";
import { fetchedPartBase, runtimePacket } from "./fixtures/runtime_packet.ts";

test("accepts the canonical packet and preserves role-aware context", async () => {
  const translated = await translateRuntimeTurnPacket(runtimePacket(), APP_SERVER_CAPABILITIES);
  assert.deepEqual(translated.modalities, ["text"]);
  assert.equal(translated.input.length, 1);
  const text = translated.input[0];
  assert.equal(text?.type, "text");
  if (text?.type !== "text") throw new Error("Expected text envelope");
  assert.match(text.text, /Hello from NanthAI/);
  assert.doesNotMatch(text.text, /opaque-fetch-handle/);
});

test("Basic search uses native live search and fails before execution on an unbound transport", async () => {
  const packet = runtimePacket();
  assert.equal((await translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES)).sessionContext.webSearch, undefined);
  packet.capabilities.webSearch = "live";
  const translated = await translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES);
  assert.equal(translated.sessionContext.webSearch, "live");
  await assert.rejects(translateRuntimeTurnPacket(packet, {
    ...APP_SERVER_CAPABILITIES,
    operations: APP_SERVER_CAPABILITIES.operations.filter((operation) => operation !== "web_search"),
  }), /does not bind native web search/);
});

test("resolves canonical images and verifies content integrity", async () => {
  const packet = runtimePacket([{
    type: "image",
    ...fetchedPartBase(),
    mimeType: "image/png",
    altText: "UI",
  }]);
  const translated = await translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES, {
    async resolve(part) {
      return { source: "local", path: `/tmp/${part.partId}.png`, sha256: part.fetch.sha256 };
    },
  });
  assert.deepEqual(translated.input[1], { type: "local_image", path: "/tmp/part-1.png" });
});

test("uses App Server native instructions and role-aware history", async () => {
  const base = runtimePacket();
  base.instructions.persona.push({
    instructionId: "persona", name: "Persona", text: "Explain findings clearly",
    sourceHash: "a".repeat(64),
  });
  const packet = RuntimeTurnPacketSchema.parse({
    ...base,
    messages: [
      {
        ordinal: 0,
        messageId: "message-prior",
        role: "assistant",
        name: "Reviewer",
        participantId: "participant-reviewer",
        content: [{ type: "text", partId: "part-prior", text: "Prior answer" }],
      },
      {
        ...base.messages[0],
        ordinal: 1,
      },
    ],
  });
  const translated = await translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES);

  assert.equal(translated.fidelity, "app_server_native_context");
  assert.equal(translated.sessionContext.baseInstructions, undefined);
  assert.match(translated.sessionContext.developerInstructions ?? "", /Be useful/);
  assert.match(translated.sessionContext.developerInstructions ?? "", /Persona/);
  assert.equal(translated.sessionContext.injectedHistory?.[0]?.role, "assistant");
  assert.match(JSON.stringify(translated.sessionContext.injectedHistory), /Reviewer/);
  assert.equal(translated.input[0]?.type, "text");
  assert.doesNotMatch(JSON.stringify(translated.input), /nanthai_runtime_turn/);
});

test("preserves participant identity for attachment-only source messages", async () => {
  const base = runtimePacket([{
    type: "image",
    ...fetchedPartBase(),
    mimeType: "image/png",
    altText: null,
  }]);
  const packet = RuntimeTurnPacketSchema.parse({
    ...base,
    messages: [{
      ...base.messages[0],
      name: null,
      participantId: "human-participant",
    }],
  });
  const translated = await translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES, {
    async resolve(part) {
      return { source: "local", path: "/tmp/image.png", sha256: part.fetch.sha256 };
    },
  });
  assert.match(JSON.stringify(translated.input[0]), /human-participant/);
  assert.deepEqual(translated.input[1], { type: "local_image", path: "/tmp/image.png" });
});

test("rejects unsupported canonical modalities before fetching bytes", async () => {
  const packet = runtimePacket([{
    type: "document",
    ...fetchedPartBase(),
    mimeType: "application/pdf",
    extractedText: "This does not replace the document",
  }]);
  let resolved = false;
  await assert.rejects(
    translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES, {
      async resolve(part) {
        resolved = true;
        return { source: "local", path: "/tmp/file", sha256: part.fetch.sha256 };
      },
    }),
    (error: unknown) => error instanceof PacketTranslationError
      && error.code === "unsupported_input_modality",
  );
  assert.equal(resolved, false);
});


test("injects earlier canonical images into resumed context without repeating source images", async () => {
  const packet = runtimePacket();
  packet.messages.unshift({
    ordinal: 0, messageId: "prior-image", role: "user", name: "Dino", participantId: null,
    content: [{ type: "image", ...fetchedPartBase(), partId: "prior-image-part", mimeType: "image/png", altText: null }],
  });
  packet.messages[1]!.ordinal = 1;
  const translated = await translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES, {
    async resolve(part) { return { source: "remote", url: "https://example.test/authorized-image", sha256: part.fetch.sha256 }; },
  });
  assert.match(JSON.stringify(translated.sessionContext.injectedHistory), /input_image.*authorized-image/);
  assert.equal(translated.input.some((part) => part.type !== "text"), false);
});


test("refuses a named NanthAI tool whose version or schema is not implemented", async () => {
  const packet = runtimePacket();
  packet.capabilities.nanthaiTools = [{ id: "nanthai_publish_result", name: "Publish", version: "2", effect: "write", inputSchemaHash: "a".repeat(64) }];
  await assert.rejects(translateRuntimeTurnPacket(packet, APP_SERVER_CAPABILITIES), /no capability binding/);
});
