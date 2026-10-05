import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import { prepareRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { buildProductionRuntimePacket } from "../runtime_host/production_packet";
import { LocalRuntimeTurnPacketSchema } from "../runtime_host/protocol_packet";
import { packetContextReceipt, readContextReceipt, receiptWithAssistant, reusableContext } from "../runtime_host/context_receipt";

const chatId = "chat-1" as Id<"chats">;
function message(id: string, role: "user" | "assistant", content: string, parent?: string): ContextMessage {
  return { _id: id as Id<"messages">, chatId, role, content,
    parentMessageIds: parent ? [parent as Id<"messages">] : [], status: "completed", createdAt: 1 };
}

async function packetForTurn(messages: ContextMessage[], sourceMessageId: string, assistantMessageId: string) {
  const fixture = LocalRuntimeTurnPacketSchema.parse(JSON.parse(
    readFileSync(new URL("../../fixtures/m45/runtime-turn-local-v1.json", import.meta.url), "utf8"),
  ));
  if (fixture.placement.placement !== "local" || !fixture.personaId) throw new Error("Expected local Persona fixture");
  const ctx = {
    runQuery: async () => [],
    scheduler: { runAfter: async () => "log" },
  } as unknown as ActionCtx;
  const preparedTurn = await prepareRequestContextForGeneration({
    ctx, chatId, userId: "user_1", assistantMessageId: assistantMessageId as Id<"messages">,
    jobId: "job-1" as Id<"generationJobs">, participantId: fixture.participantId, allMessages: messages,
    legacyMessages: buildRequestMessages({ messages, excludeMessageId: assistantMessageId as Id<"messages">,
      systemPrompt: "Be precise.", preserveMessageBoundaries: true }),
  });
  return buildProductionRuntimePacket({
    runId: fixture.runId, attemptId: fixture.attemptId, fence: fixture.fence,
    chatId, sourceMessageId,
    participantId: fixture.participantId, participantName: "Architect", personaId: fixture.personaId,
    personaPrompt: "Be precise.", preparedTurn, placement: fixture.placement,
    commandId: `turn-${sourceMessageId}`, idempotencyKey: `turn-${sourceMessageId}`,
    cancellationId: `cancel-${sourceMessageId}`, includeSourceEvidence: true,
  });
}

test("real two-turn preparation retains native reuse as supporting sources grow", async () => {
  const firstMessages = [message("user-1", "user", "Review the first plan"),
    message("answer-1", "assistant", "", "user-1")];
  const first = await packetForTurn(firstMessages, "user-1", "answer-1");
  const firstReceipt = await packetContextReceipt(first, { version: "policy-1", requireZdr: false });
  const saved = readContextReceipt(await receiptWithAssistant(JSON.stringify(firstReceipt), "answer-1", "The plan is ready."));
  const nextMessages = [firstMessages[0], message("answer-1", "assistant", "The plan is ready.", "user-1"),
    message("user-2", "user", "Review the next change", "answer-1"), message("answer-2", "assistant", "", "user-2")];
  const next = await packetForTurn(nextMessages, "user-2", "answer-2");
  assert.notEqual(first.instructions.system.find(item => item.instructionId === "sources")?.text,
    next.instructions.system.find(item => item.instructionId === "sources")?.text);
  assert.ok(next.context.evidenceSources?.some(source => source.id === "message:user-2"));
  const nextReceipt = await packetContextReceipt(next, { version: "policy-1", requireZdr: false });
  assert.equal(reusableContext(saved, nextReceipt), true);

  const edited = await packetForTurn([message("user-1", "user", "Edited first plan"), ...nextMessages.slice(1)], "user-2", "answer-2");
  assert.equal(reusableContext(saved, await packetContextReceipt(edited, { version: "policy-1", requireZdr: false })), false);
  assert.equal(reusableContext(saved, await packetContextReceipt(next, { version: "policy-1", requireZdr: true })), false);
  next.instructions.persona[0].text = "Different Persona instructions";
  assert.equal(reusableContext(saved, await packetContextReceipt(next, { version: "policy-1", requireZdr: false })), false);
});
