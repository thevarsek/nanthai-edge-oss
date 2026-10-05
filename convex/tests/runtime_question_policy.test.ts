import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { continueQuestionHandler } from "../runtime_host/question_automation";
import { automaticQuestionContent, resolveQuestionTimeout } from "../runtime_host/question_policy";
import { decryptRuntimeInputPayload, respondToRuntimeInput } from "../runtime_host/input_requests";
import { expireRuntimePermissionHandler } from "../runtime_host/permission_expiry";
import { createPermissionFixture, permissionHost, permissionRequestedEvent } from "./runtime_host_permission_fixture";

const input = (isBlocking = false, isSecret = false) => ({ source: "request_user_input", sensitiveFieldPaths: [],
  requestSchema: { isBlocking, questions: [{ id: "choice", question: "Which layout?", isSecret, options: [{ label: "A" }] }] } });
async function question(minutes?: number) {
  const state = await createPermissionFixture();
  state.rows.userPreferences = [{ _id: "prefs-1", userId: "user_1", localQuestionTimeoutMinutes: minutes, chatCompletionNotificationsEnabled: true }];
  const envelope = permissionRequestedEvent(0, state.now);
  const event = { ...envelope, payload: { ...envelope.payload, payload: { sessionId: "attempt-1", event: {
    protocolVersion: "nanthai.runtime.v1", eventId: "question-1", sequence: 0, occurredAt: state.now,
    runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1", nativeAgentThreadId: null, ...input(), type: "input_requested", inputRequestId: "input-1", prompt: "Choose a layout",
  } } } };
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  return state;
}

test("only explicitly nonblocking, nonsecret Codex questions can continue automatically", () => {
  assert.equal(resolveQuestionTimeout(), 15);
  assert.equal(resolveQuestionTimeout(0), 0);
  assert.ok(automaticQuestionContent(JSON.stringify(input()))?.choice);
  assert.equal(automaticQuestionContent(JSON.stringify(input(true))), null);
  assert.equal(automaticQuestionContent(JSON.stringify(input(false, true))), null);
  assert.equal(automaticQuestionContent(JSON.stringify({ ...input(), requestSchema: { questions: input().requestSchema.questions } })), null);
  assert.equal(automaticQuestionContent(JSON.stringify({ ...input(), source: "mcp_elicitation" })), null);
});

test("Never persists a pending request without an answer timer or duplicate notification", async () => {
  const state = await question(0);
  assert.equal(state.rows.runtimePermissionRequests.length, 1);
  assert.equal(state.rows.runtimePermissionRequests[0].automaticResponseAt, undefined);
  assert.equal(state.state.scheduled.length, 1);
  assert.equal(state.rows.runtimeCommands.length, 1);
});

test("deadline continuation is encrypted, fenced and exactly once, without claiming a human answer", async () => {
  const previous = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "fixture-question-key";
  try {
    for (const minutes of [5, 10, 15]) {
      const state = await question(minutes);
      const request = state.rows.runtimePermissionRequests[0];
      const deadline = Number(request.automaticResponseAt);
      assert.ok(deadline >= state.now + minutes * 60_000);
      assert.equal(state.state.scheduled.length, 2);
      // A live host heartbeats throughout the user wait.
      state.rows.executionAttempts[0].leaseExpiresAt = deadline + 60_000;
      state.rows.runtimeDevicePresences[0].expiresAt = deadline + 60_000;
      const args = { requestId: request._id as Id<"runtimePermissionRequests">, expectedResponseAt: deadline, now: deadline };
      assert.equal(await continueQuestionHandler(state.ctx, { ...args, now: deadline - 1 }), false);
      assert.equal(await continueQuestionHandler(state.ctx, args), true);
      assert.equal(await continueQuestionHandler(state.ctx, args), false);
      assert.equal(request.responseSource, "automatic");
      const command = state.rows.runtimeCommands[1] as unknown as Doc<"runtimeCommands">;
      assert.equal(command.authorizationSource, "configured_automation");
      assert.ok(command.payload?.startsWith("enc:v2:"));
      const answer = JSON.parse((await decryptRuntimeInputPayload(command)) ?? "{}").response.content.choice as string;
      assert.match(answer, /No human answer/);
      assert.notEqual(answer, "A");
      assert.equal(state.rows.runEvents.filter(row => String(row.eventId).startsWith("question-auto-")).length, 1);
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SECRET_ENCRYPTION_KEY; else process.env.CONVEX_SECRET_ENCRYPTION_KEY = previous; }
});

test("a human answer, cancelled run, stale deadline, or offline host wins over the automatic timer", async () => {
  const previous = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "fixture-question-key";
  try {
    for (const mode of ["human", "cancelled", "offline", "stale"]) {
      const state = await question(5);
      const request = state.rows.runtimePermissionRequests[0];
      const deadline = Number(request.automaticResponseAt);
      state.rows.executionAttempts[0].leaseExpiresAt = deadline + 60_000;
      state.rows.runtimeDevicePresences[0].expiresAt = deadline + 60_000;
      const requestId = request._id as Id<"runtimePermissionRequests">;
      if (mode === "human") await respondToRuntimeInput(state.ctx, { requestId, userId: "user_1", outcome: "submitted", content: '{"choice":"My answer"}' });
      if (mode === "cancelled") state.rows.executionRuns[0].state = "cancelling";
      if (mode === "offline") state.rows.runtimeDevicePresences[0].status = "offline";
      assert.equal(await continueQuestionHandler(state.ctx, { requestId, expectedResponseAt: mode === "stale" ? deadline - 1 : deadline, now: deadline }), false);
      assert.equal(state.rows.runtimeCommands.length, mode === "human" ? 2 : 1);
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SECRET_ENCRYPTION_KEY; else process.env.CONVEX_SECRET_ENCRYPTION_KEY = previous; }
});

test("scheduled permissions expire and fail through central cancellation, interactive permissions keep native expiry", async () => {
  const state = await createPermissionFixture();
  state.rows.generationJobs[0].sourceExecutionId = "scheduled-occurrence-1";
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event: permissionRequestedEvent(0, state.now) });
  const request = state.rows.runtimePermissionRequests[0];
  const deadline = Number(request.expiresAt);
  assert.ok(deadline >= state.now + 15 * 60_000);
  const args = { requestId: request._id as Id<"runtimePermissionRequests">, expectedExpiresAt: deadline, now: deadline };
  assert.equal(await expireRuntimePermissionHandler(state.ctx, args), true);
  assert.equal(state.rows.generationJobs[0].status, "failed");
  assert.equal(state.rows.messages[0].status, "failed");
  assert.equal(state.rows.executionRuns[0].state, "cancelling");
  assert.ok(state.rows.runtimeCommands.some(command => command.type === "cancel"));
  assert.equal(await expireRuntimePermissionHandler(state.ctx, args), false);
});
