import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { Id } from "../_generated/dataModel";
import type { RunGenerationArgs } from "../chat/actions_run_generation_types";
import { retryMessageHandler } from "../chat/mutations_retry_handler";
import { enqueueBoundConversation, advance, wakeChannelTurns } from "../channels/turn_queue";
import { receive } from "../channels/telegram/ingress";
import { admit } from "../channels/telegram/admission";
import { telegramFixture, telegramComponentFakes } from "../../test_helpers/telegram_fixture";
import { invoke } from "./conversation_context_fixture";

const source = { botId: "bot", updateId: 1, externalUserId: "42", externalChatId: "42",
  externalMessageId: 1, text: "Voice transcript", kind: "text", claimantName: "Tester" };

test("shared retry creates an ordered attempt for the same input and does not duplicate dispatch", async () => {
  telegramComponentFakes();
  const { ctx, rows, scheduled } = telegramFixture();
  try {
    const inboxId = await invoke<Id<"channelInbox">>(receive, ctx, source);
    await invoke(admit, ctx, { inboxId, claimantName: "Tester" });
    const original = rows.channelTurns[0];
    const originalArgs = original.generationArgs as RunGenerationArgs;
    rows.messages.find(m => m._id === originalArgs.userMessageId)!.createdAt = 100;
    await invoke(advance, ctx, { turnId: original._id });
    for (const id of originalArgs.generationJobIds) {
      const job = rows.generationJobs.find(j => j._id === id)!;
      job.status = "failed";
      rows.executionRuns.find(r => r._id === job.executionRunId)!.state = "failed";
    }
    rows.messages.find(m => m._id === originalArgs.assistantMessageIds[0])!.status = "failed";
    await wakeChannelTurns(ctx, "chat" as Id<"chats">);
    assert.equal(original.status, "completed");

    const laterId = await invoke(receive, ctx, { ...source, updateId: 2, externalMessageId: 2, text: "Later turn" });
    await invoke(admit, ctx, { inboxId: laterId, claimantName: "Tester" });
    const later = rows.channelTurns[1];
    await invoke(advance, ctx, { turnId: later._id });
    const retry = await retryMessageHandler(ctx, { messageId: originalArgs.assistantMessageIds[0] });
    const retriedTurn = rows.channelTurns[2];
    const retryArgs = retriedTurn.generationArgs as RunGenerationArgs;
    assert.equal(retryArgs.userMessageId, originalArgs.userMessageId);
    assert.deepEqual(retryArgs.assistantMessageIds, retry.assistantMessageIds);
    assert.equal(rows.messages.filter(m => m.role === "user").length, 2);
    assert.equal(retriedTurn.createdAt, rows.generationJobs.find(j => j._id === retryArgs.generationJobIds[0])!.createdAt);
    assert.ok(Number(retriedTurn.createdAt) >= Number(later.createdAt));
    assert.equal(await enqueueBoundConversation(ctx, retryArgs), retriedTurn.workflowId);
    assert.equal(await enqueueBoundConversation(ctx, originalArgs), original.workflowId);
    assert.equal(rows.channelTurns.length, 3);

    await invoke(advance, ctx, { turnId: retriedTurn._id });
    assert.equal(retriedTurn.status, "queued", "retry waits for the already running later turn");
    const laterArgs = later.generationArgs as RunGenerationArgs;
    for (const id of laterArgs.generationJobIds) rows.generationJobs.find(j => j._id === id)!.status = "completed";
    for (const id of laterArgs.assistantMessageIds) rows.messages.find(m => m._id === id)!.status = "completed";
    await wakeChannelTurns(ctx, "chat" as Id<"chats">);
    await invoke(advance, ctx, { turnId: retriedTurn._id });
    assert.equal(retriedTurn.status, "running");
    assert.equal(scheduled.filter(s => s.assistantMessageIds === retryArgs.assistantMessageIds).length, 1);
  } finally { mock.restoreAll(); }
});

test("a deployed pre-identity turn is adopted only for its own generation job", async () => {
  telegramComponentFakes();
  const { ctx, rows } = telegramFixture();
  try {
    const inboxId = await invoke<Id<"channelInbox">>(receive, ctx, source);
    await invoke(admit, ctx, { inboxId, claimantName: "Tester" });
    const original = rows.channelTurns[0];
    const args = original.generationArgs as RunGenerationArgs;
    delete original.generationJobId;
    assert.equal(await enqueueBoundConversation(ctx, args), original.workflowId);
    assert.equal(original.generationJobId, args.generationJobIds[0]);
    assert.equal(rows.channelTurns.length, 1);
    assert.equal(rows.executionComponentRefs.filter(r => r.role === "channel-turn-admission").length, 1);
  } finally { mock.restoreAll(); }
});

test("successive retries keep separate queue identities and dispatch only the uncancelled attempt", async () => {
  telegramComponentFakes();
  const { ctx, rows } = telegramFixture();
  try {
    const inboxId = await invoke<Id<"channelInbox">>(receive, ctx, source);
    await invoke(admit, ctx, { inboxId, claimantName: "Tester" });
    const original = rows.channelTurns[0];
    const args = original.generationArgs as RunGenerationArgs;
    const first = await retryMessageHandler(ctx, { messageId: args.assistantMessageIds[0] });
    const second = await retryMessageHandler(ctx, { messageId: first.assistantMessageIds[0] });
    assert.equal(rows.channelTurns.length, 3);
    assert.equal(new Set(rows.channelTurns.map(t => t.generationJobId)).size, 3);
    assert.equal(rows.messages.filter(m => m.role === "user").length, 1);
    await invoke(advance, ctx, { turnId: original._id });
    await invoke(advance, ctx, { turnId: rows.channelTurns[1]._id });
    assert.equal(original.status, "cancelled");
    assert.equal(rows.channelTurns[1].status, "cancelled");
    const latest = rows.channelTurns[2];
    await invoke(advance, ctx, { turnId: latest._id });
    assert.equal(latest.status, "running");
    assert.deepEqual((latest.generationArgs as RunGenerationArgs).assistantMessageIds, second.assistantMessageIds);
    assert.equal(await enqueueBoundConversation(ctx, args), original.workflowId);
    assert.equal(rows.channelTurns.length, 3);
  } finally { mock.restoreAll(); }
});
