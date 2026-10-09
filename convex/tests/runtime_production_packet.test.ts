import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionRuntimePacket,
  computeRuntimePacketHash,
  type ProductionPacketInput,
  RuntimePacketMaterializationError,
} from "../runtime_host/production_packet";
import { buildRequestMessages } from "../chat/helpers";
import { assembleContext } from "../chat/context_assembler";
import { prepareParticipantTurn } from "../chat/prepared_participant_turn";
import { recordMessageSource } from "../chat/message_provenance";
import { runtimeModelSelection } from "../runtime_host/runtime_model_selection";
import { runtimeThreadName } from "../runtime_host/runtime_thread_name";
import { autonomousRuntimeContext } from "../runtime_host/autonomous_context";

test("an Autonomous packet carries the cloud discussion handoff and canonical source, rather than repeating the old question", async () => {
  const value = input();
  value.preparedTurn = autonomousRuntimeContext(value.preparedTurn, value.sourceMessageId, value.participantName);
  const packet = await buildProductionRuntimePacket(value);
  assert.equal(packet.messages.length, 1);
  assert.equal(packet.messages[0].messageId, value.sourceMessageId);
  const prompt = packet.messages[0].content.find(part => part.type === "text");
  assert.ok(prompt?.type === "text");
  assert.match(prompt.text, /Previous participant Developer: The patch is ready/);
  assert.match(prompt.text, /Now provide Architect's next contribution/);
  assert.equal(packet.command.packetHash, await computeRuntimePacketHash(packet));
});

test("local moderator coaching is a separate hashed packet instruction", async () => {
  const value = input();
  const before = await buildProductionRuntimePacket(value);
  const after = await buildProductionRuntimePacket({ ...value, moderatorDirective: "Clarify the tradeoff." });
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.instructions.persona, before.instructions.persona);
  assert.equal(after.instructions.system.at(-1)?.text, "Clarify the tradeoff.");
  assert.notEqual(after.command.packetHash, before.command.packetHash);
});

const emptyOmissions = {
  excludedByPolicy: 0,
  excludedByBudget: 0,
  excludedByVisibility: 0,
  excludedByOwnership: 0,
  excludedByPrivacy: 0,
  excludedByBranch: 0,
  lineageMessagesSkippedByCap: 0,
  excludedByFreshness: 0,
  excludedByContradiction: 0,
  excludedAsStale: 0,
  excludedAsSuperseded: 0,
};

function input(): ProductionPacketInput {
  const value: ProductionPacketInput = {
    runId: "run-1",
    attemptId: "attempt-1",
    fence: 1,
    chatId: "chat-1",
    sourceMessageId: "message-user-1",
    participantId: "chat-participant-1",
    participantName: "Architect",
    personaId: "persona-1",
    personaPrompt: "Review code as a senior architect.",
    preparedTurn: {
      providerMessages: [
        { role: "system" as const, content: "Review code as a senior architect." },
        { role: "assistant" as const, name: "Developer", content: "The patch is ready." },
        { role: "user" as const, content: "Review the implementation" },
      ],
      context: {
        assemblerVersion: "context-v2",
        policyVersion: "policy-v2",
        artifactIds: [],
        memoryIds: [],
        omissionCounts: emptyOmissions,
        safety: { ok: true, mismatchReasons: [] },
        policyDecisions: [],
      },
    },
    placement: {
      protocolVersion: "nanthai.runtime.v1" as const,
      runId: "run-1",
      attemptId: "attempt-1",
      fence: 1,
      adapter: { adapterId: "codex", adapterVersion: "0.147.0" },
      selectedModel: { mode: "adapter_default" as const, provider: null, modelId: null },
      placement: "local" as const,
      executorKind: "local_runtime" as const,
      orchestrationEngine: "runtime_adapter" as const,
      device: { deviceId: "device-1", displayName: "Dino MacBook" },
      workingDirectory: { mode: "discover_at_session_start" as const },
    },
    commandId: "command-1",
    idempotencyKey: "run-1:attempt-1:turn-1",
    cancellationId: "cancel-run-1",
  };
  recordMessageSource(value.preparedTurn.providerMessages[1], "message-peer-1", "peer-1");
  recordMessageSource(value.preparedTurn.providerMessages[2], value.sourceMessageId, null);
  return value;
}

function sourceImage() {
  return {
    name: "architecture.png",
    mimeType: "image/png",
    altText: null,
    fetch: {
      handle: "rfa_00000000-0000-4000-8000-000000000001",
      expiresAt: 90_000,
      byteLength: 12,
      maxChunkBytes: 4 * 1024 * 1024,
      sha256: "c".repeat(64),
    },
  };
}

test("builds a hashed local text packet with Persona and canonical source identity", async () => {
  const packet = await buildProductionRuntimePacket(input());
  assert.equal(packet.command.packetHash, await computeRuntimePacketHash(packet));
  assert.equal(packet.messages.at(-1)?.messageId, "message-user-1");
  assert.equal(packet.instructions.persona[0]?.text, "Review code as a senior architect.");
  assert.equal(packet.instructions.system.length, 0);
  assert.equal(packet.participantId, "chat-participant-1");
  assert.equal(packet.placement.placement, "local");
});

test("Basic search binds native live search into the packet hash; plain turns retain native policy", async () => {
  const plain = await buildProductionRuntimePacket(input());
  const search = await buildProductionRuntimePacket({ ...input(), webSearchEnabled: true });
  assert.equal(plain.capabilities.webSearch, undefined);
  assert.equal(search.capabilities.webSearch, "live");
  assert.notEqual(plain.command.packetHash, search.command.packetHash);
  assert.equal(search.capabilities.adapterNativePolicy, "preserve");
});

test("materializes Collaboration causality without changing the selected route", async () => {
  const value = input();
  value.preparedTurn.causality = {
    exchangeId: "exchange-1" as never,
    decisionId: "decision-1" as never,
    wave: 2,
    frontierMessageIds: ["message-user-1" as never],
    replyToMessageIds: ["message-peer-1" as never],
  };
  recordMessageSource(value.preparedTurn.providerMessages[2], value.sourceMessageId, null);
  const packet = await buildProductionRuntimePacket(value);
  assert.deepEqual(packet.causality.replyToMessageIds, ["message-peer-1"]);
  assert.equal(packet.causality.liveDiscussion?.waveNumber, 2);
  assert.equal(packet.placement.device.deviceId, "device-1");
});

test("fails clearly when an image has no canonical storage-backed handle", async () => {
  const value = input();
  value.preparedTurn.providerMessages[2] = {
    role: "user",
    content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }],
  };
  await assert.rejects(
    buildProductionRuntimePacket(value),
    (error) => error instanceof RuntimePacketMaterializationError
      && error.code === "RUNTIME_IMAGE_FETCH_UNAVAILABLE",
  );
});

test("materializes a source image fetch descriptor and binds it into the packet hash", async () => {
  const value = input();
  value.sourceImages = [sourceImage()];
  value.preparedTurn.providerMessages[2] = {
    role: "user",
    content: [
      { type: "text", text: "Review the implementation" },
      { type: "image_url", image_url: { url: "https://storage.example/image" } },
    ],
  };
  recordMessageSource(value.preparedTurn.providerMessages[2], value.sourceMessageId, null);
  const packet = await buildProductionRuntimePacket(value);
  const source = packet.messages.find((message) => message.messageId === value.sourceMessageId);
  const image = source?.content.find((part) => part.type === "image");
  assert.equal(image?.type, "image");
  if (image?.type !== "image") throw new Error("Expected source image");
  assert.deepEqual(image.fetch, sourceImage().fetch);
  const originalHash = packet.command.packetHash;
  image.fetch.handle = "rfa_00000000-0000-4000-8000-000000000002";
  assert.notEqual(await computeRuntimePacketHash(packet), originalHash);
});

test("image-only source resolution ignores a later Collaboration handoff", async () => {
  const value = input();
  value.sourceImages = [sourceImage()];
  value.preparedTurn.providerMessages = [
    { role: "system", content: value.personaPrompt ?? "" },
    {
      role: "user",
      content: [{
        type: "image_url",
        image_url: { url: "https://storage.example/image" },
      }],
    },
    { role: "user", content: "[NanthAI Collaboration handoff]" },
  ];
  recordMessageSource(value.preparedTurn.providerMessages[1], value.sourceMessageId, null);
  const packet = await buildProductionRuntimePacket(value);
  const source = packet.messages.find((message) => message.messageId === value.sourceMessageId);
  assert.equal(source?.content.some((part) => part.type === "image"), true);
  assert.equal(source?.content.some((part) => part.type === "text"), false);
});

test("keeps the Persona cloud model out of adapter-default local placement", () => {
  assert.deepEqual(runtimeModelSelection({
    modelSelectionMode: "adapter_default",
    provider: "openai",
    modelId: "openai/gpt-5.6-sol-pro",
  }), {
    mode: "adapter_default",
    provider: null,
    modelId: null,
  });
  assert.deepEqual(runtimeModelSelection({
    modelSelectionMode: "explicit",
    provider: "openai",
    modelId: "gpt-5.6-sol",
  }), {
    mode: "explicit",
    provider: "openai",
    modelId: "gpt-5.6-sol",
  });
  assert.throws(
    () => runtimeModelSelection({ modelSelectionMode: "explicit" }),
    /requires a model ID/,
  );
});

test("uses a short NanthAI prefix and the canonical chat title for native thread names", () => {
  assert.equal(
    runtimeThreadName("Feature review", "chat-12345678"),
    "NanthAI · Feature review",
  );
  assert.equal(
    runtimeThreadName("   ", "chat-12345678"),
    "NanthAI · Chat 12345678",
  );
  assert.equal(runtimeThreadName("A".repeat(600), "chat-12345678").length, 512);
});


test("shared assembly keeps identical human and peer text tied to distinct canonical identities", async () => {
  const value = input();
  const messages = [
    { _id: "human-old", role: "user", chatParticipantId: undefined },
    { _id: "peer-old", role: "assistant", chatParticipantId: "peer-participant" },
    { _id: value.sourceMessageId, role: "user", chatParticipantId: undefined },
    { _id: "pending-answer", role: "assistant", chatParticipantId: value.participantId },
  ].map((message, index, all) => ({ ...message, content: "Same words", status: index === 3 ? "pending" : "completed", createdAt: index, parentMessageIds: index === 0 ? [] : [all[index - 1]._id] }));
  const legacyMessages = buildRequestMessages({ messages: messages as Parameters<typeof buildRequestMessages>[0]["messages"], excludeMessageId: "pending-answer" as never, preserveMessageBoundaries: true });
  value.preparedTurn = prepareParticipantTurn(assembleContext({ chatId: "chat-1" as never, messageId: "pending-answer" as never, jobId: "job-1" as never, userId: "user_1", legacyMessages, rawArtifacts: [], toolMemories: [] }));
  const packet = await buildProductionRuntimePacket(value);
  assert.deepEqual(packet.messages.map((message) => message.messageId), ["human-old", "peer-old", value.sourceMessageId]);
  assert.equal(packet.messages[1].participantId, "peer-participant");
  value.preparedTurn.providerMessages.pop();
  await assert.rejects(buildProductionRuntimePacket(value), /omitted the requested source/);
});

test("a goal-start control event retains its canonical source in a local request without becoming system policy", async () => {
  const value = input();
  const source = { _id: value.sourceMessageId as never, chatId: "chat-1" as never,
    role: "system" as const, collaborationGoalAction: "start_or_resume" as const,
    content: "Goals started or resumed: Prepare a book-club checklist.", parentMessageIds: [], status: "completed", createdAt: 1 };
  value.preparedTurn.providerMessages = buildRequestMessages({ messages: [source,
    { _id: "reply" as never, chatId: "chat-1" as never, role: "assistant", content: "", parentMessageIds: [source._id], status: "pending", createdAt: 2 }],
    excludeMessageId: "reply" as never, systemPrompt: value.personaPrompt ?? "", memoryContext: "", preserveMessageBoundaries: true });
  const packet = await buildProductionRuntimePacket(value);
  assert.equal(source.role, "system");
  const delivered = packet.messages.find(message => message.messageId === value.sourceMessageId);
  assert.equal(delivered?.role, "user");
  assert.ok(delivered?.content.some(part => part.type === "text" && part.text.includes("book-club checklist")));
  assert.ok(!packet.instructions.system.some(instruction => instruction.text.includes("book-club checklist")));
});
