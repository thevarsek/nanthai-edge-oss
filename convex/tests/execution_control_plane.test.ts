import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  assertCurrentExecution,
  claimExecutionRun,
} from "../execution/attempts";
import {
  bindRuntimeSession,
  releaseRuntimeSession,
} from "../execution/bindings";
import {
  cancelExecutionForGenerationJob,
  requestExecutionCancellation,
} from "../execution/cancellation";
import { transitionRuntimeCommand } from "../execution/commands";
import {
  linkExecutionComponent,
  terminalizeExecutionComponentsForRun,
} from "../execution/component_refs";
import {
  assertCurrentFence,
  claimGenerationExecution,
  createGenerationExecution,
  releaseExecutionForContinuation,
  terminalizeExecution,
} from "../execution/control_plane";
import { createExecutionRun } from "../execution/runs";
import {
  finalizeRunCancellationIfSettled,
  requestRunTreeTeardown,
} from "../execution/teardown_graph";
import { appendRunEventUnchecked } from "../execution/events";
import {
  createAndClaimDomainExecution,
  heartbeatDomainExecution,
  interruptDomainExecution,
  linkDomainComponent,
  terminalizeDomainExecution,
} from "../execution/domain_lifecycle";
import { prepareOperationHandler } from "../execution/operations";
import { terminalizeParentGenerationExecution } from "../chat/video_mutation_handlers";

type Rows = Record<string, Array<Record<string, unknown>>>;

function fixture() {
  const rows: Rows = {
    chats: [{
      _id: "chat_1",
      userId: "user_1",
      title: "Test",
      mode: "single",
      createdAt: 1,
      updatedAt: 1,
    }],
    accountDeletionTombstones: [],
    generationJobs: [
      {
        _id: "job_1",
        chatId: "chat_1",
        messageId: "message_1",
        userId: "user_1",
        modelId: "model_1",
        status: "queued",
        createdAt: 1,
      },
    ],
    executionRuns: [],
    executionAttempts: [],
    runEvents: [],
    executionComponentRefs: [],
    runtimeSessionBindings: [],
    runtimeCommands: [],
    executionOperations: [],
    executionTeardownTasks: [],
  };
  return { rows, ctx: createStatefulMockCtx(rows) as unknown as MutationCtx };
}

test("a durable continuation creates a new attempt and permanently fences the old writer", async () => {
  const { rows, ctx } = fixture();
  const now = Date.now();
  await createGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    userId: "user_1",
    chatId: "chat_1" as Id<"chats">,
    sourceMessageId: "message_1" as Id<"messages">,
    now,
  });
  const first = await claimGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    claimantId: "invocation-a",
    now: now + 1,
  });
  assert.ok(first);
  await releaseExecutionForContinuation(ctx, {
    attemptId: first.attemptId,
    fence: first.fence,
    claimantId: "invocation-a",
    now: now + 2,
  });
  const second = await claimGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    claimantId: "invocation-b",
    now: now + 3,
  });
  assert.ok(second);
  assert.notEqual(second.attemptId, first.attemptId);
  assert.equal(second.fence, first.fence + 1);
  await assert.rejects(
    assertCurrentFence(ctx, first.attemptId, first.fence),
    /STALE_EXECUTION_ATTEMPT/,
  );
  await assertCurrentFence(ctx, second.attemptId, second.fence);
  assert.equal(rows.executionAttempts[0].status, "superseded");
  assert.equal(
    rows.executionAttempts[0].supersededByAttemptId,
    second.attemptId,
  );
});

test("an explicit event id cannot be replayed with different canonical data", async () => {
  const { ctx } = fixture();
  const execution = await createExecutionRun(ctx, {
    userId: "user_1",
    runKey: "event-conflict",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      protocolVersion: "nanthai-execution-v1",
    },
  });
  const run = await ctx.db.get(execution.runId);
  assert.ok(run);
  await appendRunEventUnchecked(ctx, run, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    type: "model_activity",
    summary: "first payload",
    eventId: "stable-event",
  });
  await assert.rejects(
    appendRunEventUnchecked(ctx, run, {
      attemptId: execution.attemptId,
      fence: execution.fence,
      type: "model_activity",
      summary: "different payload",
      eventId: "stable-event",
    }),
    /RUN_EVENT_IDEMPOTENCY_CONFLICT/,
  );
});

test("a prepared write is still dispatchable after a durable attempt handoff", async () => {
  const { rows, ctx } = fixture();
  const execution = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    generationJobId: "job_1" as Id<"generationJobs">,
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
    },
  });
  const first = await claimExecutionRun(ctx, {
    runId: execution.runId,
    claimantId: "first",
  });
  assert.ok(first);
  const common = {
    jobId: "job_1" as Id<"generationJobs">,
    operationKey: "stable-write",
    toolName: "gmail_send",
    effect: "write" as const,
    retry: "never" as const,
    authorizationSource: "explicit_user_turn" as const,
    inputHash: "hash",
  };
  const prepared = await prepareOperationHandler(ctx, {
    ...common,
    attemptId: first.attemptId,
    fence: first.fence,
    toolCallId: "call_1",
  });
  assert.equal(prepared.decision, "execute");
  await releaseExecutionForContinuation(ctx, {
    attemptId: first.attemptId,
    fence: first.fence,
    claimantId: "first",
  });
  const second = await claimExecutionRun(ctx, {
    runId: execution.runId,
    claimantId: "second",
  });
  assert.ok(second);
  const rebound = await prepareOperationHandler(ctx, {
    ...common,
    attemptId: second.attemptId,
    fence: second.fence,
    toolCallId: "call_2",
  });
  assert.equal(rebound.decision, "execute");
  assert.equal(rows.executionOperations[0].attemptId, second.attemptId);
  assert.equal(rows.executionOperations[0].toolCallId, "call_2");
});

test("video settlement closes its parent generation execution", async () => {
  const { rows, ctx } = fixture();
  const parent = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    generationJobId: "job_1" as Id<"generationJobs">,
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
    },
  });
  const parentClaim = await claimExecutionRun(ctx, {
    runId: parent.runId,
    claimantId: "generation",
  });
  assert.ok(parentClaim);
  const child = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "media",
    requestedPlacement: "cloud",
    generationJobId: "job_1" as Id<"generationJobs">,
    parentRunId: parent.runId,
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
    },
  });
  rows.generationJobs[0].status = "completed";

  await terminalizeParentGenerationExecution(
    ctx,
    child.runId,
    "job_1" as Id<"generationJobs">,
  );

  const parentRow = rows.executionRuns.find((run) => run._id === parent.runId);
  assert.equal(parentRow?.state, "completed");
});

test("execution creation rejects account, chat, and parent deletion fences", async () => {
  const account = fixture();
  account.rows.accountDeletionTombstones.push({
    _id: "delete_user_1",
    userId: "user_1",
    requestedAt: 1,
  });
  await assert.rejects(
    createExecutionRun(account.ctx, {
      userId: "user_1",
      kind: "chat_generation",
      requestedPlacement: "cloud",
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
      },
    }),
    /ACCOUNT_DELETION_IN_PROGRESS/,
  );

  const chat = fixture();
  chat.rows.chats[0].isDeleting = true;
  await assert.rejects(
    createExecutionRun(chat.ctx, {
      userId: "user_1",
      chatId: "chat_1" as Id<"chats">,
      kind: "chat_generation",
      requestedPlacement: "cloud",
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
      },
    }),
    /EXECUTION_CHAT_NOT_WRITABLE/,
  );

  const parentFixture = fixture();
  const parent = await createExecutionRun(parentFixture.ctx, {
    userId: "user_1",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
    },
  });
  await parentFixture.ctx.db.patch(parent.runId, { state: "cancelling" });
  await assert.rejects(
    createExecutionRun(parentFixture.ctx, {
      userId: "user_1",
      parentRunId: parent.runId,
      kind: "subagent",
      requestedPlacement: "cloud",
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
      },
    }),
    /EXECUTION_PARENT_NOT_WRITABLE/,
  );
});

test("teardown persists a bounded frontier for execution trees larger than 2,000 runs", async () => {
  const { rows, ctx } = fixture();
  const root = await createExecutionRun(ctx, {
    userId: "user_1",
    runKey: "large-root",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      protocolVersion: "nanthai-execution-v1",
    },
  });
  for (let index = 0; index < 2_050; index += 1) {
    rows.executionRuns.push({
      _id: `large_child_${index}`,
      userId: "user_1",
      parentRunId: root.runId,
      kind: "subagent",
      state: "running",
      requestedPlacement: "cloud",
      nextAttemptNumber: 1,
      nextEventSequence: 0,
      createdAt: index,
      updatedAt: index,
    });
  }
  await requestRunTreeTeardown(ctx, root.runId, "user_1", "large teardown");
  assert.equal(rows.executionTeardownTasks.length, 51);
  assert.equal(
    rows.executionTeardownTasks.find((task) => task.runId === root.runId)?.status,
    "expanding",
  );
});

test("teardown advances only one child-page frontier per mutation", async () => {
  const { rows, ctx } = fixture();
  const root = await createExecutionRun(ctx, {
    userId: "user_1",
    runKey: "paged-root",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      protocolVersion: "nanthai-execution-v1",
    },
  });
  for (let index = 0; index < 2; index += 1) {
    rows.executionRuns.push({
      _id: `paged_child_${index}`,
      userId: "user_1",
      parentRunId: root.runId,
      kind: "subagent",
      state: "running",
      requestedPlacement: "cloud",
      nextAttemptNumber: 1,
      nextEventSequence: 0,
      createdAt: index,
      updatedAt: index,
    });
  }

  await requestRunTreeTeardown(ctx, root.runId, "user_1", "paged teardown");
  await requestRunTreeTeardown(ctx, root.runId, "user_1", "paged teardown");

  const childTasks = rows.executionTeardownTasks.filter(
    (task) => task.runId !== root.runId,
  );
  assert.equal(childTasks.filter((task) => task.status === "pending").length, 1);
  assert.equal(
    childTasks.filter((task) => task.status === "waiting_for_children").length,
    1,
  );
});

test("domain workflows dedupe their run key without pretending active components have stopped", async () => {
  const { rows, ctx } = fixture();
  const execution = await createAndClaimDomainExecution(ctx, {
    userId: "user_1",
    runKey: "research:session_1:workflow_1",
    kind: "research",
    domainType: "search_session",
    domainId: "session_1",
    claimantId: "research-workflow:workflow_1",
    chatId: "chat_1" as Id<"chats">,
  });
  const duplicate = await createAndClaimDomainExecution(ctx, {
    userId: "user_1",
    runKey: "research:session_1:workflow_1",
    kind: "research",
    domainType: "search_session",
    domainId: "session_1",
    claimantId: "research-workflow:workflow_1",
    chatId: "chat_1" as Id<"chats">,
  });
  assert.deepEqual(Object.keys(execution).sort(), [
    "attemptId",
    "claimantId",
    "fence",
    "runId",
  ]);
  assert.equal("leaseExpiresAt" in execution, false);
  assert.equal(duplicate.runId, execution.runId);
  assert.equal(duplicate.attemptId, execution.attemptId);
  await heartbeatDomainExecution(ctx, execution);
  await linkDomainComponent(ctx, execution, {
    adapterId: "convex-workflow",
    operationId: "workflow_1",
    role: "research-workflow",
  });
  await linkDomainComponent(ctx, execution, {
    adapterId: "background-workpool",
    operationId: "work_1",
    role: "search-query",
  });
  await terminalizeDomainExecution(
    ctx,
    execution,
    "completed",
    "Research complete",
  );
  await terminalizeDomainExecution(
    ctx,
    execution,
    "completed",
    "Duplicate completion",
  );
  assert.equal(rows.executionRuns.length, 1);
  assert.equal(rows.executionRuns[0].state, "completed");
  assert.ok(rows.executionComponentRefs.every((ref) => ref.status === "active"));
  assert.equal(
    rows.runEvents.filter((event) => event.type === "completed").length,
    1,
  );
});

test("pausing a domain workflow interrupts its fence while cancellation drains components", async () => {
  const { rows, ctx } = fixture();
  const execution = await createAndClaimDomainExecution(ctx, {
    userId: "user_1",
    runKey: "autonomous:session_1:workflow_1",
    kind: "autonomous_chat",
    domainType: "autonomous_session",
    domainId: "session_1",
    claimantId: "autonomous-workflow:workflow_1",
    chatId: "chat_1" as Id<"chats">,
  });
  await linkDomainComponent(ctx, execution, {
    adapterId: "convex-workflow",
    operationId: "autonomous_workflow_1",
    role: "autonomous-workflow",
  });
  await interruptDomainExecution(ctx, execution, "Paused by user");
  assert.equal(rows.executionRuns[0].state, "interrupted");
  assert.equal(rows.executionAttempts[0].status, "interrupted");
  assert.equal(rows.executionComponentRefs[0].status, "active");
  await assert.rejects(
    heartbeatDomainExecution(ctx, execution),
    /EXECUTION_ATTEMPT_NOT_WRITABLE/,
  );
});

test("lease expiry permits a new claimant without allowing the old claimant to publish", async () => {
  const { ctx } = fixture();
  const now = Date.now();
  const created = await createGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    userId: "user_1",
    chatId: "chat_1" as Id<"chats">,
    sourceMessageId: "message_1" as Id<"messages">,
    now,
  });
  const first = await claimExecutionRun(ctx, {
    runId: created.runId,
    claimantId: "worker-a",
    leaseMs: 10,
    now: now + 1,
  });
  assert.ok(first);
  assert.equal(
    await claimExecutionRun(ctx, {
      runId: created.runId,
      claimantId: "worker-b",
      leaseMs: 10,
      now: now + 5,
    }),
    null,
  );
  const second = await claimExecutionRun(ctx, {
    runId: created.runId,
    claimantId: "worker-b",
    leaseMs: 10,
    now: now + 12,
  });
  assert.ok(second);
  await assert.rejects(
    assertCurrentExecution(ctx, {
      attemptId: first.attemptId,
      fence: first.fence,
      claimantId: "worker-a",
      now: now + 13,
    }),
    /STALE_EXECUTION_ATTEMPT/,
  );
  await assertCurrentExecution(ctx, {
    attemptId: second.attemptId,
    fence: second.fence,
    claimantId: "worker-b",
    now: now + 13,
  });
});

test("duplicate terminal writes return the canonical outcome without another event", async () => {
  const { rows, ctx } = fixture();
  const created = await createGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    userId: "user_1",
    chatId: "chat_1" as Id<"chats">,
    sourceMessageId: "message_1" as Id<"messages">,
    now: Date.now(),
  });
  await terminalizeExecution(ctx, {
    attemptId: created.attemptId,
    fence: created.fence,
    outcome: "completed",
  });
  await terminalizeExecution(ctx, {
    attemptId: created.attemptId,
    fence: created.fence,
    outcome: "failed",
    summary: "late duplicate",
  });
  assert.equal(rows.executionRuns[0].state, "completed");
  assert.deepEqual(
    rows.runEvents.map((event) => event.type),
    ["created", "completed"],
  );
});

test("recursive teardown cancels descendants, commands, bindings, and every component ref", async () => {
  const { rows, ctx } = fixture();
  const now = Date.now();
  const root = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "chat_generation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "workflow",
    },
    now,
  });
  const child = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "subagent",
    requestedPlacement: "cloud",
    parentRunId: root.runId,
    initialAttempt: {
      executorKind: "convex_action",
      placement: "cloud",
      adapterId: "subagent",
    },
    now,
  });
  const rootClaim = await claimExecutionRun(ctx, {
    runId: root.runId,
    claimantId: "root",
    now: now + 1,
  });
  const childClaim = await claimExecutionRun(ctx, {
    runId: child.runId,
    claimantId: "child",
    now: now + 1,
  });
  assert.ok(rootClaim && childClaim);
  await linkExecutionComponent(ctx, {
    runId: root.runId,
    attemptId: rootClaim.attemptId,
    fence: rootClaim.fence,
    adapterId: "convex-workflow",
    operationId: "workflow-1",
    role: "root",
    now,
  });
  await linkExecutionComponent(ctx, {
    runId: child.runId,
    attemptId: childClaim.attemptId,
    fence: childClaim.fence,
    adapterId: "interactive-workpool",
    operationId: "work-1",
    role: "child",
    now,
  });
  await linkExecutionComponent(ctx, {
    runId: child.runId,
    attemptId: childClaim.attemptId,
    fence: childClaim.fence,
    adapterId: "background-workpool",
    operationId: "work-2",
    role: "post-process",
    now,
  });
  await linkExecutionComponent(ctx, {
    runId: child.runId,
    attemptId: childClaim.attemptId,
    fence: childClaim.fence,
    adapterId: "maintenance-workpool",
    operationId: "work-3",
    role: "cleanup",
    now,
  });
  await bindRuntimeSession(ctx, {
    attemptId: childClaim.attemptId,
    fence: childClaim.fence,
    bindingKey: "primary",
    adapterId: "pi",
    nativeSessionId: "session-1",
    now,
  });
  rows.runtimeCommands.push({
    _id: "command_1",
    runId: child.runId,
    attemptId: childClaim.attemptId,
    userId: "user_1",
    commandId: "cancel-me",
    expectedFence: childClaim.fence,
    type: "prompt",
    status: "pending",
    authorizationSource: "explicit_user_turn",
    initiatedBy: "user_1",
    inputHash: "hash",
    createdAt: now,
    updatedAt: now,
  });
  const components: Array<{ operationId: string }> = [];
  for (let pass = 0; pass < 50; pass += 1) {
    const next = await requestRunTreeTeardown(
      ctx,
      root.runId,
      "user_1",
      "test teardown",
    );
    components.push(...next);
    for (const component of next) {
      if (!component.componentRefId) continue;
      await ctx.db.patch(component.componentRefId, {
        status: "cancelled",
        terminalAt: now + pass + 1,
        updatedAt: now + pass + 1,
      });
    }
    if (components.length === 4) break;
  }
  assert.deepEqual(
    new Set(components.map((item) => item.operationId)),
    new Set(["workflow-1", "work-1", "work-2", "work-3"]),
  );
  assert.ok(rows.executionRuns.every(
    (run) => run.state === "cancelling" || run.state === "cancelled",
  ));
  assert.equal(rows.runtimeCommands[0].status, "rejected");
  assert.equal(rows.runtimeSessionBindings[0].status, "revoked");
  assert.ok(
    rows.executionComponentRefs.every(
      (ref) => ref.status === "cancel_requested" || ref.status === "cancelled",
    ),
  );
  for (const run of rows.executionRuns) {
    assert.equal(
      await finalizeRunCancellationIfSettled(
        ctx,
        run._id as Id<"executionRuns">,
        now + 1,
      ),
      true,
    );
  }
  assert.ok(rows.executionRuns.every((run) => run.state === "cancelled"));
  assert.equal(
    rows.runEvents.filter((event) => event.type === "cancel_acknowledged").length,
    2,
  );
});

test("runtime command transitions cannot regress or be consumed by another claimant", async () => {
  const { rows, ctx } = fixture();
  const command = {
    _id: "command_1",
    runId: "run_1",
    attemptId: "attempt_1",
    userId: "user_1",
    commandId: "command",
    expectedFence: 1,
    type: "prompt",
    status: "pending",
    authorizationSource: "explicit_user_turn",
    initiatedBy: "user_1",
    inputHash: "hash",
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Doc<"runtimeCommands">;
  rows.runtimeCommands.push(command as unknown as Record<string, unknown>);
  await transitionRuntimeCommand(ctx, command, {
    status: "acknowledged",
    claimantId: "runtime-a",
    now: 2,
  });
  await assert.rejects(
    transitionRuntimeCommand(
      ctx,
      rows.runtimeCommands[0] as unknown as Doc<"runtimeCommands">,
      {
        status: "completed",
        claimantId: "runtime-b",
        now: 3,
      },
    ),
    /RUNTIME_COMMAND_CLAIMANT_MISMATCH/,
  );
  await transitionRuntimeCommand(
    ctx,
    rows.runtimeCommands[0] as unknown as Doc<"runtimeCommands">,
    {
      status: "completed",
      claimantId: "runtime-a",
      now: 3,
    },
  );
  await assert.rejects(
    transitionRuntimeCommand(
      ctx,
      rows.runtimeCommands[0] as unknown as Doc<"runtimeCommands">,
      {
        status: "acknowledged",
        claimantId: "runtime-a",
        now: 4,
      },
    ),
    /RUNTIME_COMMAND_TERMINAL/,
  );
});

test("only an unclaimed runtime command may expire", async () => {
  const { rows, ctx } = fixture();
  const pending = {
    _id: "command_pending",
    runId: "run_1",
    attemptId: "attempt_1",
    userId: "user_1",
    commandId: "pending",
    expectedFence: 1,
    type: "prompt",
    status: "pending",
    authorizationSource: "explicit_user_turn",
    initiatedBy: "user_1",
    inputHash: "hash",
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Doc<"runtimeCommands">;
  rows.runtimeCommands.push(pending as unknown as Record<string, unknown>);
  await transitionRuntimeCommand(ctx, pending, { status: "expired", now: 2 });
  assert.equal(rows.runtimeCommands[0].status, "expired");

  const acknowledged = {
    ...pending,
    _id: "command_acknowledged",
    commandId: "acknowledged",
    status: "acknowledged",
    claimedBy: "runtime-a",
  } as unknown as Doc<"runtimeCommands">;
  rows.runtimeCommands.push(acknowledged as unknown as Record<string, unknown>);
  await assert.rejects(
    transitionRuntimeCommand(ctx, acknowledged, { status: "expired", now: 3 }),
    /RUNTIME_COMMAND_ALREADY_CLAIMED/,
  );
});

test("runtime binding lifecycle is idempotent and cannot be rebound after release", async () => {
  const { ctx } = fixture();
  const now = Date.now();
  const execution = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "local_runtime",
    requestedPlacement: "local",
    initialAttempt: {
      executorKind: "local_runtime",
      placement: "local",
      adapterId: "pi",
    },
    now,
  });
  const claim = await claimExecutionRun(ctx, {
    runId: execution.runId,
    claimantId: "device",
    now: now + 1,
  });
  assert.ok(claim);
  const bindingId = await bindRuntimeSession(ctx, {
    attemptId: claim.attemptId,
    fence: claim.fence,
    bindingKey: "primary",
    adapterId: "pi",
    nativeSessionId: "native-1",
    now,
  });
  assert.equal(
    await bindRuntimeSession(ctx, {
      attemptId: claim.attemptId,
      fence: claim.fence,
      bindingKey: "primary",
      adapterId: "pi",
      nativeSessionId: "native-1",
      now,
    }),
    bindingId,
  );
  assert.equal(
    await releaseRuntimeSession(ctx, {
      bindingId,
      attemptId: claim.attemptId,
      fence: claim.fence,
      reason: "done",
      now: now + 2,
    }),
    "released",
  );
  assert.equal(
    await releaseRuntimeSession(ctx, {
      bindingId,
      attemptId: claim.attemptId,
      fence: claim.fence,
      now: now + 3,
    }),
    "released",
  );
  await assert.rejects(
    bindRuntimeSession(ctx, {
      attemptId: claim.attemptId,
      fence: claim.fence,
      bindingKey: "primary",
      adapterId: "pi",
      nativeSessionId: "native-2",
      now: now + 4,
    }),
    /RUNTIME_BINDING_CONFLICT/,
  );
});

test("successful run completion waits for component callbacks before closing references", async () => {
  const { rows, ctx } = fixture();
  const execution = await createExecutionRun(ctx, {
    userId: "user_1",
    kind: "presentation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "workflow",
    },
    now: Date.now(),
  });
  await linkExecutionComponent(ctx, {
    runId: execution.runId,
    attemptId: execution.attemptId,
    fence: execution.fence,
    adapterId: "convex-workflow",
    operationId: "workflow-success",
    role: "orchestrator",
  });
  await linkExecutionComponent(ctx, {
    runId: execution.runId,
    attemptId: execution.attemptId,
    fence: execution.fence,
    adapterId: "interactive-workpool",
    operationId: "work-success",
    role: "fanout",
  });
  await terminalizeExecution(ctx, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    outcome: "completed",
  });
  assert.ok(rows.executionComponentRefs.every((ref) => ref.status === "active"));
  assert.equal(
    await terminalizeExecutionComponentsForRun(ctx, {
      runId: execution.runId,
      status: "completed",
    }),
    2,
  );
  assert.ok(rows.executionComponentRefs.every((ref) => ref.status === "completed"));
});

test("generation cancellation closes the fence while durable teardown drains", async () => {
  const { rows, ctx } = fixture();
  const created = await createGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    userId: "user_1",
    chatId: "chat_1" as Id<"chats">,
    sourceMessageId: "message_1" as Id<"messages">,
    now: Date.now(),
  });
  assert.equal(
    await cancelExecutionForGenerationJob(ctx, {
      jobId: "job_1" as Id<"generationJobs">,
      requestedBy: "user_1",
    }),
    true,
  );
  assert.equal(rows.executionRuns[0].state, "cancelling");
  await assert.rejects(
    assertCurrentFence(ctx, created.attemptId, created.fence),
    /EXECUTION_CANCELLATION_REQUESTED/,
  );
});

test("generation cancellation leaves owned components cancel_requested until quiescence", async () => {
  const { rows, ctx } = fixture();
  const created = await createGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    userId: "user_1",
    chatId: "chat_1" as Id<"chats">,
    sourceMessageId: "message_1" as Id<"messages">,
    now: Date.now(),
  });
  await linkExecutionComponent(ctx, {
    runId: created.runId,
    attemptId: created.attemptId,
    fence: created.fence,
    adapterId: "convex-workflow",
    operationId: "workflow-in-flight",
    role: "generation-workflow-primary",
  });

  await cancelExecutionForGenerationJob(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    requestedBy: "user_1",
  });
  await requestRunTreeTeardown(
    ctx,
    created.runId,
    "user_1",
    "Cancelled by user_1",
  );

  assert.equal(rows.executionRuns[0].state, "cancelling");
  assert.equal(rows.executionComponentRefs[0]?.status, "cancel_requested");
  assert.equal(rows.executionComponentRefs[0]?.terminalAt, undefined);
});

test("a cancellation request immediately closes the writer fence", async () => {
  const { ctx } = fixture();
  const created = await createGenerationExecution(ctx, {
    jobId: "job_1" as Id<"generationJobs">,
    userId: "user_1",
    chatId: "chat_1" as Id<"chats">,
    sourceMessageId: "message_1" as Id<"messages">,
    now: Date.now(),
  });
  assert.equal(
    await requestExecutionCancellation(ctx, {
      jobId: "job_1" as Id<"generationJobs">,
      requestedBy: "user_1",
    }),
    true,
  );
  await assert.rejects(
    assertCurrentFence(ctx, created.attemptId, created.fence),
    /EXECUTION_CANCELLATION_REQUESTED/,
  );
});
