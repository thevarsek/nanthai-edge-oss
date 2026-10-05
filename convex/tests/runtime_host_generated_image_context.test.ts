import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import { prepareRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { materializeSourceImages } from "../runtime_host/chat_dispatch_images";
import { getOwnedGeneratedMessageImages } from "../runtime_host/generated_image_context";
import { buildProductionRuntimePacket } from "../runtime_host/production_packet";
import { LocalRuntimeTurnPacketSchema } from "../runtime_host/protocol_packet";
import { getRuntimeAttachmentForHost, registerRuntimeAttachmentFetchHandles } from "../runtime_host/attachment_fetch_handles";
import { sha256Hex } from "../runtime_host/security";

const now = 10_000;
const expiresAt = now + 60_000;
const chatId = "chat" as Id<"chats">;
const imageId = "image" as Id<"messages">;
const sourceId = "follow-up" as Id<"messages">;
const assistantId = "response" as Id<"messages">;
const imageUrl = "https://storage.example/generated-image";
const blob = new Blob([new Uint8Array([0, 1, 2])], { type: "image/png" });
const host = { deviceId: "device", credentialId: "credential", credential: "secret", presenceSessionId: "presence" };

async function fixture() {
  const messages: ContextMessage[] = [
    { _id: "initial" as Id<"messages">, chatId, role: "user", content: "Generate a design",
      parentMessageIds: [], status: "completed", createdAt: 1 },
    { _id: imageId, chatId, role: "assistant", content: "", imageUrls: [imageUrl],
      parentMessageIds: ["initial" as Id<"messages">], status: "completed", createdAt: 2 },
    { _id: sourceId, chatId, role: "user", content: "Review this design",
      parentMessageIds: [imageId], status: "completed", createdAt: 3 },
    { _id: assistantId, chatId, role: "assistant", content: "", parentMessageIds: [sourceId], status: "pending", createdAt: 4 },
  ];
  const claimantId = "runtime-host:device:presence";
  const rows: Record<string, Array<Record<string, unknown>>> = {
    chats: [{ _id: chatId, userId: "user" }], messages: messages.map(message => ({ ...message, userId: "user" })),
    generatedMedia: [{ _id: "media", messageId: imageId, chatId, userId: "user", type: "image",
      storageId: "generated-image", mimeType: "image/png", sizeBytes: blob.size }],
    runtimeAttachmentFetchHandles: [],
    runtimeTurnPackets: [{ _id: "packet", runId: "run", attemptId: "attempt", userId: "user", fence: 1, commandId: "turn", expiresAt }],
    executionRuns: [{ _id: "run", chatId, userId: "user", activeAttemptId: "attempt", state: "running" }],
    executionAttempts: [{ _id: "attempt", runId: "run", userId: "user", fence: 1, status: "running",
      placement: "local", executorKind: "local_runtime", deviceId: "device", claimantId, leaseExpiresAt: expiresAt }],
    runtimeCommands: [{ _id: "command", turnPacketId: "packet", runId: "run", attemptId: "attempt", userId: "user",
      commandId: "turn", expectedFence: 1, type: "start", status: "acknowledged", targetDeviceId: "device", claimedBy: claimantId, expiresAt }],
    runtimeDevices: [{ _id: "device-row", deviceId: "device", userId: "user", status: "active" }],
    runtimeDeviceCredentials: [{ _id: "credential-row", runtimeDeviceId: "device-row", deviceId: "device", userId: "user",
      credentialId: "credential", credentialHash: await sha256Hex("secret"), status: "active" }],
    runtimeDevicePresences: [{ _id: "presence-row", runtimeDeviceId: "device-row", deviceId: "device", userId: "user",
      credentialId: "credential", presenceSessionId: "presence", status: "online", expiresAt }],
  };
  const ctx = createStatefulMockCtx(rows, {
    storage: { get: async () => blob, getUrl: async () => imageUrl,
      getMetadata: async () => ({ size: blob.size, contentType: blob.type }) },
  });
  const actionCtx = { ...ctx, runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: {
    userId: string; chatId: Id<"chats">; messageId: Id<"messages">;
  }) => getFunctionName(ref) === "runtime_host/generated_image_context:listForMessage"
    ? getOwnedGeneratedMessageImages(ctx as unknown as QueryCtx, args) : [],
  } as unknown as ActionCtx;
  return { ctx, actionCtx, rows, messages };
}

test("generated-image selected-parent handoff materializes and authenticates the published storage", async () => {
  const { ctx, actionCtx, rows, messages } = await fixture();
  const preparedTurn = await prepareRequestContextForGeneration({ ctx: actionCtx, chatId, userId: "user",
    assistantMessageId: assistantId, jobId: "job" as Id<"generationJobs">, participantId: "participant", allMessages: messages,
    legacyMessages: buildRequestMessages({ messages, excludeMessageId: assistantId, preserveMessageBoundaries: true }),
  });
  const images = await materializeSourceImages(actionCtx, rows.messages as unknown as Doc<"messages">[],
    expiresAt, new Set([imageUrl]), "user");
  const route = LocalRuntimeTurnPacketSchema.parse(JSON.parse(readFileSync(
    new URL("../../fixtures/m45/runtime-turn-local-v1.json", import.meta.url), "utf8")));
  if (route.placement.placement !== "local" || !route.personaId) throw new Error("Expected local fixture");
  const packet = await buildProductionRuntimePacket({ runId: route.runId, attemptId: route.attemptId, fence: route.fence,
    chatId, sourceMessageId: sourceId, sourceImages: images.packetParts,
    participantId: route.participantId, participantName: "Reviewer", personaId: route.personaId, preparedTurn,
    placement: route.placement, commandId: "turn", idempotencyKey: "turn", cancellationId: "cancel" });
  const image = packet.messages.find(message => message.messageId === sourceId)?.content.find(part => part.type === "image");
  assert.equal(image?.type, "image");
  assert.equal(images.grants.length, 1);
  assert.equal(images.grants[0].sha256, createHash("sha256").update(new Uint8Array([0, 1, 2])).digest("hex"));
  assert.equal(image?.type === "image" && image.fetch.sha256, images.grants[0].sha256);
  assert.equal(images.grants[0].sourceMessageId, imageId);
  await registerRuntimeAttachmentFetchHandles(ctx as unknown as MutationCtx, {
    turnPacketId: "packet" as Id<"runtimeTurnPackets">, grants: images.grants, now,
  });
  const authorized = await getRuntimeAttachmentForHost(ctx as unknown as QueryCtx,
    { ...host, handle: images.grants[0].handle }, now);
  assert.equal(authorized?.storageId, "generated-image");
  assert.equal(authorized?.byteLength, blob.size);
  assert.equal(authorized?.sha256, images.grants[0].sha256);

  for (const [field, value] of [["userId", "other-user"], ["chatId", "other-chat"],
    ["messageId", "other-message"], ["sizeBytes", 99], ["mimeType", "image/jpeg"]] as const) {
    const original = rows.generatedMedia[0][field];
    rows.generatedMedia[0][field] = value;
    await assert.rejects(registerRuntimeAttachmentFetchHandles(ctx as unknown as MutationCtx, {
      turnPacketId: "packet" as Id<"runtimeTurnPackets">, grants: images.grants, now,
    }), /owned canonical message image/);
    rows.generatedMedia[0][field] = original;
  }
  rows.messages.find(message => message._id === imageId)!.imageUrls = [];
  await assert.rejects(registerRuntimeAttachmentFetchHandles(ctx as unknown as MutationCtx, {
    turnPacketId: "packet" as Id<"runtimeTurnPackets">, grants: images.grants, now,
  }), /owned canonical message image/);
});
