import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LocalRuntimeTurnPacketSchema } from "../runtime_host/protocol_packet";
import { packetContextReceipt, readContextReceipt, receiptWithAssistant, reusableContext } from "../runtime_host/context_receipt";

test("reuse preserves completed context and rebuilds for edited, hidden or reordered history and policy changes", async () => {
  const parsed = LocalRuntimeTurnPacketSchema.parse(JSON.parse(readFileSync(new URL("../../fixtures/m45/runtime-turn-local-v1.json", import.meta.url), "utf8")));
  assert.ok(parsed.personaId);
  assert.equal(parsed.placement.placement, "local");
  if (parsed.placement.placement !== "local") throw new Error("Expected local fixture");
  const packet = { ...parsed, personaId: parsed.personaId, placement: parsed.placement };
  const first = await packetContextReceipt(packet, { version: "v1", requireZdr: false });
  const saved = readContextReceipt(await receiptWithAssistant(JSON.stringify(first), "our-answer", "Done"));
  packet.messages.push({ ordinal: packet.messages.length, messageId: "our-answer", role: "assistant", name: null, participantId: packet.participantId, content: [{ type: "text", partId: "answer", text: "Done" }] });
  const complete = await packetContextReceipt(packet, { version: "v1", requireZdr: false });
  assert.equal(reusableContext(saved, complete), true);
  assert.equal(reusableContext(saved, { ...complete, entries: complete.entries.slice(1) }), false);
  assert.equal(reusableContext(saved, { ...complete, entries: [...complete.entries].reverse() }), false);
  assert.equal(reusableContext(saved, { ...complete, entries: complete.entries.map((entry, i) => i === 0 ? { ...entry, hash: "edited" } : entry) }), false);
  assert.equal(reusableContext(saved, await packetContextReceipt(packet, { version: "v1", requireZdr: true })), false);
  packet.capabilities.webSearch = "live";
  assert.equal(reusableContext(saved, await packetContextReceipt(packet, { version: "v1", requireZdr: false })), false);
  assert.equal(reusableContext(null, complete), false);
});
