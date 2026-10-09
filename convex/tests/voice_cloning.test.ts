import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { validateReferencePlaceholders, validateVoiceCloningRequest } from "../chat/voice_cloning_contract";
import { projectVoiceCloningCapabilities, prepareSpeechEndpoints } from "../models/speech_capabilities";
import { getTurnReferences } from "../chat/voice_cloning";
import { hydrateAttachmentsForRequest, type AttachmentStorageContext } from "../chat/action_attachment_hydration";

const reference = (id: string) => ({ storageId: id as Id<"_storage"> });
const attachments = ["one", "two", "three"].map((storageId) => ({ storageId, mimeType: "audio/wav", sizeBytes: 100 }));
const caps = { maxAudioReferences: 3, maxZdrAudioReferences: 1 };

test("cloning projects only compatible endpoint combinations, including ZDR and multiple references", () => {
  const projection = projectVoiceCloningCapabilities(prepareSpeechEndpoints([
    { tag: "ordinary", supports_voice_cloning: false, supports_multiple_audio_references: true },
    { tag: "cloning", supports_voice_cloning: true },
    { tag: "multi", supports_voice_cloning: true, supports_multiple_audio_references: true },
  ], new Set(["ordinary", "cloning"]), 1));
  assert.equal(projection.maxAudioReferences, 3);
  assert.equal(projection.maxZdrAudioReferences, 1);
  assert.equal(projectVoiceCloningCapabilities().supportsVoiceCloning, false);
});

test("request admission accepts one to three owned references and refuses missing permission, invalid media and unsupported counts", () => {
  for (const count of [1, 2, 3]) validateVoiceCloningRequest({ modelId: "seed", permissionConfirmed: true,
    references: attachments.slice(0, count).map((item) => reference(item.storageId)) }, caps, false, attachments);
  const request = { modelId: "seed", permissionConfirmed: true, references: [reference("one")] };
  assert.throws(() => validateVoiceCloningRequest({ ...request, permissionConfirmed: false }, caps, false, attachments), /permission/);
  assert.throws(() => validateVoiceCloningRequest(request, undefined, false, attachments), /does not support/);
  assert.throws(() => validateVoiceCloningRequest(request, caps, false, []), /owned audio/);
  assert.throws(() => validateVoiceCloningRequest(request, caps, false, [{ ...attachments[0], mimeType: "image/png" }]), /audio recordings/);
  assert.throws(() => validateVoiceCloningRequest(request, caps, false, [{ ...attachments[0], sizeBytes: 15 * 1024 * 1024 + 1 }]), /15 MiB/);
  assert.throws(() => validateVoiceCloningRequest({ ...request, references: [{ ...reference("one"), transcript: "x".repeat(10_001) }] }, caps, false, attachments), /10,000/);
  assert.throws(() => validateVoiceCloningRequest({ ...request, references: [reference("one"), reference("two")] }, caps, true, attachments), /one and 1/);
  assert.throws(() => validateVoiceCloningRequest({ ...request, references: [reference("one"), reference("one")] }, caps, false, attachments), /different recording/);
});

test("Seed placeholder validation preserves exact selected clips", () => {
  validateReferencePlaceholders("bytedance-seed/seed-audio-1-0", "@Audio1 Hello @Audio2 Welcome", 2);
  validateReferencePlaceholders("bytedance-seed/seed-audio-1-0", "Hello", 1);
  assert.throws(() => validateReferencePlaceholders("bytedance-seed/seed-audio-1-0", "@Audio1 Hello", 2), /every supplied/);
  assert.throws(() => validateReferencePlaceholders("bytedance-seed/seed-audio-1-0", "@Audio3 Hello", 2), /missing clip/);
  validateReferencePlaceholders("fish-audio/s2.1-pro", "Literal @Audio2", 1);
});

test("turn references come only from the immediate owned request and fail visibly after reference deletion", async () => {
  const rows = new Map<string, Record<string, unknown>>([
    ["assistant", { userId: "user", chatId: "chat", parentMessageIds: ["source"] }],
    ["chat", { userId: "user" }],
    ["source", { _id: "source", role: "user", userId: "user", chatId: "chat",
      voiceCloning: { modelId: "fish", permissionConfirmed: true, references: [reference("one")] } }],
  ]);
  let owned = [{ userId: "user", messageId: "source" }];
  const ctx = {
    db: { get: async (id: string) => rows.get(id), system: { get: async () => ({ contentType: "audio/wav", size: 100 }) },
      query: () => ({ withIndex: () => ({ collect: async () => owned }) }) },
    storage: { getUrl: async () => "https://owned.example/audio" },
  };
  const handler = (getTurnReferences as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
  const result = await handler(ctx, { messageId: "assistant", userId: "user" });
  assert.ok(result);
  assert.equal(await handler(ctx, { messageId: "assistant", userId: "other" }), null);
  owned = [{ userId: "other", messageId: "source" }];
  await assert.rejects(() => handler(ctx, { messageId: "assistant", userId: "user" }), /no longer owned/);
  rows.set("source", { role: "assistant", userId: "user", chatId: "chat" });
  assert.equal(await handler(ctx, { messageId: "assistant", userId: "user" }), null);
});

test("normal context hydration never reads or inlines voice reference bytes", async () => {
  let reads = 0;
  const ctx = { storage: { get: async () => { reads += 1; return new Blob(["private voice"]); } } } as unknown as AttachmentStorageContext;
  const messages = [{ _id: "source" as Id<"messages">, role: "user", content: "Speak",
    attachments: [{ type: "voice_reference", storageId: "one" as Id<"_storage">, mimeType: "audio/wav" }] }];
  const result = await hydrateAttachmentsForRequest(ctx, messages);
  assert.equal(reads, 0);
  assert.equal(result[0].attachments?.[0].url, undefined);
});
