import { getFunctionName } from "convex/server";
import { transferWorkAttempt } from "../collaboration/work_attempt_ownership";
import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { assertAcyclicDependencies, workDependenciesCommitted } from "../collaboration/work_policy";
import { claimWorkForJob, requireWorkClaim } from "../collaboration/work_claims";
import { commitWorkReview } from "../collaboration/work_reviews";
import { publishCollaborationJobTerminal } from "../collaboration/work_publication";
import { activateWorkScope } from "../collaboration/work_scope";
import { eligibleWork } from "../collaboration/work_context";
import { publishWork, releaseWork, reviseWork } from "../collaboration/work_mutations";
import { invoke } from "./conversation_context_fixture";
import { startWorkRun } from "../collaboration/work_control";
import { observeProgress } from "../collaboration/work_progress";

const id = <T extends "collaborationWork" | "generationJobs" | "executionAttempts">(value: string) => value as Id<T>;
function fixture() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    chats: [{ _id: "chat", userId: "owner", isDeleting: false }],
    collaborationWork: [{ _id: "work", userId: "owner", chatId: "chat", objective: "Write a proposal",
      acceptanceCriteria: ["Includes costs"], requirementRevision: 1, revision: 1,
      evidenceRevision: 0, evidence: [], dependencyIds: [], reviewerIds: ["reviewer"],
      assigneeId: "writer", status: "open", needsRevalidation: false, linkedRunIds: [] }],
    executionRuns: ["a", "b", "team"].map((key) => ({ _id: `run_${key}`, activeAttemptId: `attempt_${key}`,
      userId: "owner", chatId: "chat", state: "running" })),
    executionAttempts: ["a", "b", "team"].map((key) => ({ _id: `attempt_${key}`, runId: `run_${key}`,
      userId: "owner", status: "running", fence: 1, leaseExpiresAt: Date.now() + 60_000 })),
    generationJobs: ["a", "b"].map((key) => ({ _id: `job_${key}`, userId: "owner", chatId: "chat",
      messageId: `message_${key}`, chatParticipantId: "writer", executionRunId: `run_${key}`,
      executionAttemptId: `attempt_${key}`, executionFence: 1, status: "streaming" })),
    messages: ["a", "b"].map((key) => ({ _id: `message_${key}`, userId: "owner", chatId: "chat",
      status: "streaming", content: "Published proposal", parentMessageIds: ["root"] })),
  };
  const state = createStatefulMockCtx(rows);
  const ctx = state as unknown as MutationCtx;
  const work = () => rows.collaborationWork[0] as unknown as Doc<"collaborationWork">;
  const job = (key: string) => rows.generationJobs.find((row) => row._id === `job_${key}`) as unknown as Doc<"generationJobs">;
  return { rows, ctx, work, job };
}

test("dependency cycles are rejected and independent committed inputs are eligible", () => {
  const nodes = [{ id: "a", dependencyIds: [], status: "done", needsRevalidation: false },
    { id: "b", dependencyIds: ["a"], status: "open", needsRevalidation: false },
    { id: "slow", dependencyIds: [], status: "in_progress", needsRevalidation: false }];
  assert.equal(workDependenciesCommitted(nodes[1], nodes), true);
  assert.throws(() => assertAcyclicDependencies(nodes, "a", ["b"]), /CYCLE/);
  assert.equal(workDependenciesCommitted({ dependencyIds: ["slow"] }, nodes), false);
  assert.equal(workDependenciesCommitted({ dependencyIds: ["missing"] }, nodes), false);
});

test("competing work claims are atomic and the same job claim is idempotent", async () => {
  const f = fixture();
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
  const revision = f.work().revision;
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
  assert.equal(f.work().revision, revision);
  await assert.rejects(claimWorkForJob(f.ctx, f.work(), f.job("b"), Date.now() + 30_000), /running owner/);
});

test("expired worker cannot publish through a stale claim", async () => {
  const f = fixture();
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() - 1);
  await assert.rejects(requireWorkClaim(f.ctx, { userId: "owner", workId: id<"collaborationWork">("work"),
    jobId: id<"generationJobs">("job_a"), attemptId: id<"executionAttempts">("attempt_a"), fence: 1 }), /expired/);
});

test("publication waits for a committed reply and retains changed-requirement evidence for revalidation", async () => {
  const f = fixture();
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
  await f.ctx.db.patch(f.work()._id, { pendingPublication: { description: "Proposal with costs", sourceRevision: "draft-1" },
    requirementRevision: 2 });
  await f.ctx.db.patch(f.job("a").messageId, { status: "completed" });
  await publishCollaborationJobTerminal(f.ctx, { ...f.job("a"), status: "completed",
    collaborationExchangeId: "exchange" as Id<"collaborationExchanges"> });
  assert.equal(f.work().status, "review");
  assert.equal(f.work().needsRevalidation, true);
  assert.equal(f.work().evidence[0].messageId, "message_a");
  await assert.rejects(commitWorkReview(f.ctx, f.work(), { requirementRevision: 1, evidenceRevision: 1,
    sourceRevision: "draft-1", outcome: "accept", reason: "Looks fine", author: "reviewer" }), /no longer matches/);
});

test("a partial committed result wakes ready work without including a slower response", async () => {
  const f = fixture();
  f.rows.collaborationExchanges = [{ _id: "exchange", userId: "owner", chatId: "chat", status: "waiting",
    workEnabled: true, currentWave: 1, publishedMessageCount: 0, frontierMessageIds: ["root"],
    pendingHumanMessageIds: [], activeParticipantIds: ["writer", "slow"], failedParticipantIds: [],
    participantSnapshot: [{ participantId: "writer" }, { participantId: "slow" }],
    bounds: { maxWaves: 5, maxParticipantMessages: 3, deadlineAt: Date.now() + 30_000 },
    executionRunId: "run_team", executionAttemptId: "attempt_team", executionFence: 1,
    executionClaimantId: "team" }];
  f.rows.collaborationDecisions = [{ _id: "decision", exchangeId: "exchange", status: "dispatched",
    generationJobIds: ["job_a", "job_b"], assistantMessageIds: ["message_a", "message_b"] }];
  await f.ctx.db.patch(f.job("a")._id, { status: "completed" });
  await f.ctx.db.patch(f.job("a").messageId, { status: "completed" });
  await f.ctx.db.patch(f.job("b")._id, { chatParticipantId: "slow" as Id<"chatParticipants"> });
  // Convex reads are immutable snapshots: db.patch must not update documents
  // already returned to this mutation. One reserved slow reply leaves one slot.
  const query = f.ctx.db.query.bind(f.ctx.db);
  Object.defineProperty(f.ctx.db, "query", { value: (table: "collaborationDecisions") => {
    const chain = query(table);
    const collect = chain.collect.bind(chain);
    chain.collect = async () => structuredClone(await collect());
    return chain;
  } });
  const handler = observeProgress as unknown as { _handler: (ctx: MutationCtx, args: {
    exchangeId: Id<"collaborationExchanges">; execution: { runId: Id<"executionRuns">;
      attemptId: Id<"executionAttempts">; fence: number; claimantId: string };
  }) => Promise<{ kind: string }> };
  const result = await handler._handler(f.ctx, { exchangeId: "exchange" as Id<"collaborationExchanges">,
    execution: { runId: "run_team" as Id<"executionRuns">, attemptId: "attempt_team" as Id<"executionAttempts">,
      fence: 1, claimantId: "team" } });
  assert.equal(result.kind, "ready");
  assert.deepEqual(f.rows.collaborationExchanges[0].frontierMessageIds, ["root", "message_a"]);
  assert.deepEqual(f.rows.collaborationExchanges[0].activeParticipantIds, ["slow"]);
});


test("job completion before message commit retains the claim and staged publication", async () => {
  const f = fixture();
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
  await f.ctx.db.patch(f.work()._id, { pendingPublication: { description: "Proposal", sourceRevision: "draft-1" } });
  const terminalJob = { ...f.job("a"), status: "completed" as const,
    collaborationExchangeId: "exchange" as Id<"collaborationExchanges"> };
  await publishCollaborationJobTerminal(f.ctx, terminalJob);
  assert.equal(f.work().status, "in_progress");
  assert.equal(f.work().claim?.jobId, "job_a");
  assert.equal(f.work().pendingPublication?.sourceRevision, "draft-1");
  await f.ctx.db.patch(f.job("a").messageId, { status: "completed" });
  await publishCollaborationJobTerminal(f.ctx, terminalJob);
  assert.equal(f.work().status, "review");
  assert.equal(f.work().evidenceRevision, 1);
  assert.equal(f.work().claim, undefined);
});

test("canonical continuation transfers only its own live work claim and retains frozen requirements", async () => {
  const f = fixture();
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
  await f.ctx.db.patch(f.work()._id, { pendingPublication: { description: "Proposal", sourceRevision: "draft-1" }, requirementRevision: 2 });
  const run = { ...f.rows.executionRuns[0], generationJobId: "job_a" } as unknown as Doc<"executionRuns">;
  const previous = f.rows.executionAttempts[0] as unknown as Doc<"executionAttempts">;
  await transferWorkAttempt(f.ctx, run, previous, { attemptId: id<"executionAttempts">("next"), fence: 2 }, Date.now());
  assert.equal(f.work().claim?.attemptId, "next");
  assert.equal(f.work().claim?.fence, 2);
  assert.equal(f.work().claim?.requirementRevision, 1);
  assert.equal(f.work().pendingPublication?.sourceRevision, "draft-1");
  await assert.rejects(requireWorkClaim(f.ctx, { userId: "owner", workId: f.work()._id,
    jobId: f.job("a")._id, attemptId: previous._id, fence: 1 }), /expired|another/);
  await transferWorkAttempt(f.ctx, run, previous, { attemptId: id<"executionAttempts">("stale"), fence: 3 }, Date.now());
  assert.equal(f.work().claim?.attemptId, "next");
});

test("automatic assignment claims exactly one owner and no-review goals complete only after message commit", async () => {
  const f = fixture();
  await f.ctx.db.patch(f.work()._id, { assigneeId: undefined, reviewerIds: [] });
  await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
  assert.equal(f.work().assigneeId, "writer");
  await f.ctx.db.patch(f.work()._id, { pendingPublication: { description: "Includes costs", sourceRevision: "v1" } });
  const terminal = { ...f.job("a"), status: "completed" as const, collaborationExchangeId: "exchange" as Id<"collaborationExchanges"> };
  await publishCollaborationJobTerminal(f.ctx, terminal);
  assert.equal(f.work().status, "in_progress");
  await f.ctx.db.patch(f.job("a").messageId, { status: "completed" });
  await publishCollaborationJobTerminal(f.ctx, terminal);
  assert.equal(f.work().status, "done");
  assert.equal(f.work().evidence[0].messageId, "message_a");
});


test("cancelled or completed goals cannot create a synthetic continuation message", async () => {
  const f = fixture();
  const messages = f.rows.messages.length;
  await f.ctx.db.patch(f.work()._id, { status: "cancelled" });
  await assert.rejects(startWorkRun(f.ctx, "owner", "chat" as Id<"chats">), /no remaining goals/);
  await f.ctx.db.patch(f.work()._id, { status: "done" });
  await assert.rejects(startWorkRun(f.ctx, "owner", "chat" as Id<"chats">), /no remaining goals/);
  assert.equal(f.rows.messages.length, messages);
});

test("a human-attached committed result follows the same optional-review completion policy", async (t) => {
  const f = fixture();
  t.mock.method(f.ctx.auth, "getUserIdentity", async () => ({ subject: "owner" }) as never);
  t.mock.method(f.ctx, "runQuery", async (ref: unknown) => { assert.equal(getFunctionName(ref as never), "account/deletion_state:isAccountDeletionStarted"); return false as never; });
  await f.ctx.db.patch(f.work()._id, { reviewerIds: [] });
  await f.ctx.db.patch(f.job("a").messageId, { status: "completed" });
  const handler = publishWork as unknown as { _handler: (ctx: MutationCtx, args: { workId: Id<"collaborationWork">; revision: number; evidence: Array<{ messageId: Id<"messages">; sourceRevision: string; description: string }> }) => Promise<null> };
  await handler._handler(f.ctx, { workId: f.work()._id, revision: f.work().revision,
    evidence: [{ messageId: f.job("a").messageId, sourceRevision: "v1", description: "Verified criteria" }] });
  assert.equal(f.work().status, "done");
});

test("explicit start scopes parked goals and activates only required inputs", async () => {
  const f = fixture();
  f.rows.collaborationWork.push({ ...f.rows.collaborationWork[0], _id: "parked", deferred: true, dependencyIds: [] },
    { ...f.rows.collaborationWork[0], _id: "input", deferred: true, status: "done", evidence: [{ messageId: "message_a", sourceRevision: "v1", description: "Input" }] });
  await f.ctx.db.patch(f.work()._id, { deferred: true, dependencyIds: ["input" as Id<"collaborationWork">] });
  const ids = await activateWorkScope(f.ctx, f.rows.collaborationWork as unknown as Doc<"collaborationWork">[], [f.work()._id]);
  assert.deepEqual(ids, ["work", "input"]);
  assert.equal(f.rows.collaborationWork[1].deferred, true);
  const selected = await eligibleWork(f.ctx, "chat" as Id<"chats">, ids);
  assert.deepEqual(selected.candidates.map(row => row._id), ["work"]);
  assert.equal(selected.rows.some(row => String(row._id) === "parked"), false);
});

for (const reviewerIds of [[], ["reviewer"]]) {
  test(`dependency edits during execution retain stale evidence until explicit retry (${reviewerIds.length} reviewers)`, async (t) => {
    const f = fixture();
    t.mock.method(f.ctx.auth, "getUserIdentity", async () => ({ subject: "owner" }) as never);
    t.mock.method(f.ctx, "runQuery", async (ref: unknown) => {
      assert.equal(getFunctionName(ref as never), "account/deletion_state:isAccountDeletionStarted");
      return false as never;
    });
    const dependencyId = id<"collaborationWork">("dependency");
    f.rows.collaborationWork.push({ ...f.work(), _id: dependencyId, status: "done", reviewerIds: [] });
    await f.ctx.db.patch(f.work()._id, { dependencyIds: [dependencyId], reviewerIds: reviewerIds as Id<"chatParticipants">[] });
    await claimWorkForJob(f.ctx, f.work(), f.job("a"), Date.now() + 30_000);
    await invoke(reviseWork, f.ctx, { workId: dependencyId, revision: 1,
      objective: "Use the new budget", acceptanceCriteria: ["New costs"], reviewerIds: [], dependencyIds: [] });
    assert.equal(f.work().needsRevalidation, true);
    await f.ctx.db.patch(f.work()._id, { pendingPublication: { description: "Old budget", sourceRevision: "v1" } });
    await f.ctx.db.patch(f.job("a").messageId, { status: "completed" });
    await publishCollaborationJobTerminal(f.ctx, { ...f.job("a"), status: "completed",
      collaborationExchangeId: "exchange" as Id<"collaborationExchanges"> });
    assert.equal(f.work().status, "review");
    assert.equal(f.work().needsRevalidation, true);
    assert.equal(f.work().evidence[0].messageId, "message_a");
    await assert.rejects(commitWorkReview(f.ctx, f.work(), { requirementRevision: 1, evidenceRevision: 1,
      sourceRevision: "v1", outcome: "accept", reason: "Review", author: "reviewer" }), /no longer matches/);

    // The owner accepts the revised prerequisite, then explicitly retries B.
    const dependency = f.rows.collaborationWork[1] as unknown as Doc<"collaborationWork">;
    await commitWorkReview(f.ctx, dependency, { requirementRevision: dependency.requirementRevision,
      evidenceRevision: dependency.evidenceRevision, sourceRevision: dependency.sourceRevision ?? "",
      outcome: "override", reason: "I verified the new budget", author: "owner" });
    await invoke(releaseWork, f.ctx, { workId: f.work()._id, revision: f.work().revision,
      cancel: false, reason: "Explicit owner retry" });
    await claimWorkForJob(f.ctx, f.work(), f.job("b"), Date.now() + 30_000);
    assert.equal(f.work().needsRevalidation, false);
    await f.ctx.db.patch(f.work()._id, { pendingPublication: { description: "New budget", sourceRevision: "v2" } });
    await f.ctx.db.patch(f.job("b").messageId, { status: "completed" });
    await publishCollaborationJobTerminal(f.ctx, { ...f.job("b"), status: "completed",
      collaborationExchangeId: "exchange" as Id<"collaborationExchanges"> });
    assert.equal(f.work().needsRevalidation, false);
    assert.equal(f.work().status, reviewerIds.length ? "review" : "done");
    assert.equal(f.work().evidenceRevision, 2);
    assert.equal(f.work().evidence[0].messageId, "message_b");
  });
}
