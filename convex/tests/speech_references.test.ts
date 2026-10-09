import test from "node:test";
import assert from "node:assert/strict";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ToolExecutionContext } from "../tools/registry";
import { resolveSpeechReferences } from "../tools/speech_references";

function context(count: number, consent = true): ToolExecutionContext {
  const references = Array.from({ length: count }, (_, index) => ({
    storageId: `owned_${index}` as Id<"_storage">, transcript: `Transcript ${index}`,
    url: `https://owned.example/${index}`, mimeType: "audio/wav", sizeBytes: 100,
  }));
  return { userId: "owner", ctx: { runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(ref) === "chat/voice_cloning:getTurnReferences") {
      return { request: { modelId: "bytedance-seed/seed-audio-1-0", permissionConfirmed: consent,
        references: references.map(({ storageId, transcript }) => ({ storageId, transcript })) }, references };
    }
    return { speechCapabilities: { maxAudioReferences: 3, maxZdrAudioReferences: 3 } };
  } } } as unknown as ToolExecutionContext;
}

test("speech resolution pins the consented model and preserves URL/transcript pairing for one to three clips", async () => {
  for (const count of [1, 2, 3]) {
    const prompt = Array.from({ length: count }, (_, index) => `@Audio${index + 1} Hello`).join(" ");
    const resolved = await resolveSpeechReferences(context(count), "message" as Id<"messages">, prompt, undefined, undefined, true);
    assert.equal(resolved?.modelId, "bytedance-seed/seed-audio-1-0");
    assert.equal(resolved?.referenceCount, count);
    assert.deepEqual(resolved?.inputReferences, Array.from({ length: count }, (_, index) => [
      { type: "input_audio", input_audio: { url: `https://owned.example/${index}` } },
      { type: "text", text: `Transcript ${index}` },
    ]).flat());
  }
});

test("speech resolution cannot change the selected model, substitute recordings or infer consent", async () => {
  const id = "message" as Id<"messages">;
  await assert.rejects(() => resolveSpeechReferences(context(1), id, "Hello", "other", undefined, false), /explicitly selected/);
  await assert.rejects(() => resolveSpeechReferences(context(1), id, "Hello", undefined, ["foreign"], false), /exactly/);
  await assert.rejects(() => resolveSpeechReferences(context(1, false), id, "Hello", undefined, undefined, false), /permission/);
});

test("an empty optional array binds the explicitly selected references in order", async () => {
  const resolved = await resolveSpeechReferences(context(2), "message" as Id<"messages">,
    "@Audio1 Hello @Audio2 Hi", undefined, [], true);
  assert.equal(resolved?.referenceCount, 2);
  assert.deepEqual(resolved?.inputReferences?.filter(reference => reference.type === "input_audio"), [
    { type: "input_audio", input_audio: { url: "https://owned.example/0" } },
    { type: "input_audio", input_audio: { url: "https://owned.example/1" } },
  ]);
  await assert.rejects(() => resolveSpeechReferences(context(2), "message" as Id<"messages">,
    "@Audio1 Hello @Audio2 Hi", undefined, ["owned_1", "owned_0"], true), /exactly/);
});
