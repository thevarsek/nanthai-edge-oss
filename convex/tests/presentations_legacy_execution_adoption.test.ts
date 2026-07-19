import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { resolvePresentationActionContext } from
  "../presentations/legacy_action_identity";
import { adoptLegacyPresentationExecutionHandler } from
  "../presentations/legacy_execution_adoption";
import {
  oldPresentationRows,
  presentationMutationContext as mutationContext,
} from "../../test_helpers/presentation_legacy_fixture";

test("old-shaped presentation runs atomically adopt a claimed legacy execution", async () => {
  const rows = oldPresentationRows();
  assert.equal("executionAttemptId" in rows.presentationGenerationRuns[0], false);
  assert.equal("executionAttemptId" in rows.presentationProjects[0], false);

  const adopted = await adoptLegacyPresentationExecutionHandler(
    mutationContext(rows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  );

  assert.ok(adopted);
  assert.equal(rows.executionRuns.length, 1);
  assert.equal(rows.executionAttempts.length, 1);
  const executionRun = rows.executionRuns[0];
  const attempt = rows.executionAttempts[0];
  assert.equal(executionRun.runKey, "presentation:project_1");
  assert.equal(executionRun.kind, "presentation");
  assert.equal(executionRun.generationJobId, "job_1");
  assert.equal(executionRun.domainId, "project_1");
  assert.equal(attempt.executorKind, "convex_action");
  assert.equal(attempt.orchestrationEngine, "legacy_scheduler");
  assert.equal(attempt.orchestrationVersion, "pre-m47-adopted-v1");
  assert.equal(attempt.rolloutCohort, "legacy-drain");
  assert.equal(attempt.status, "running");
  assert.equal(attempt.claimantId, "presentation:project_1");
  assert.ok(Number(attempt.leaseExpiresAt) > Date.now());

  for (const row of [
    rows.presentationGenerationRuns[0],
    rows.presentationProjects[0],
  ]) {
    assert.equal(row.executionRunId, adopted.executionRunId);
    assert.equal(row.executionAttemptId, adopted.executionAttemptId);
    assert.equal(row.executionFence, adopted.executionFence);
  }

  const repeated = await adoptLegacyPresentationExecutionHandler(
    mutationContext(rows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  );
  assert.deepEqual(repeated, adopted);
  assert.equal(rows.executionRuns.length, 1);
  assert.equal(rows.executionAttempts.length, 1);
});

test("an expired adopted lease is superseded without losing the legacy run", async () => {
  const rows = oldPresentationRows();
  const first = await adoptLegacyPresentationExecutionHandler(
    mutationContext(rows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  );
  assert.ok(first);
  rows.executionAttempts[0].leaseExpiresAt = 0;

  const replacement = await adoptLegacyPresentationExecutionHandler(
    mutationContext(rows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  );

  assert.ok(replacement);
  assert.equal(replacement.executionRunId, first.executionRunId);
  assert.notEqual(replacement.executionAttemptId, first.executionAttemptId);
  assert.equal(replacement.executionFence, first.executionFence + 1);
  assert.equal(rows.executionAttempts.length, 2);
  assert.equal(rows.executionAttempts[0].status, "superseded");
  assert.equal(rows.executionAttempts[1].orchestrationEngine, "legacy_scheduler");
  assert.equal(rows.executionAttempts[1].status, "running");
  assert.equal(
    rows.presentationGenerationRuns[0].executionAttemptId,
    replacement.executionAttemptId,
  );
  assert.equal(rows.presentationProjects[0].executionFence, replacement.executionFence);
});

test("identity-less actions cannot adopt a modern presentation execution", async () => {
  const rows = oldPresentationRows();
  Object.assign(rows.presentationGenerationRuns[0], {
    executionRunId: "execution_modern",
    executionAttemptId: "attempt_modern",
    executionFence: 7,
  });
  Object.assign(rows.presentationProjects[0], {
    executionRunId: "execution_modern",
    executionAttemptId: "attempt_modern",
    executionFence: 7,
  });
  rows.executionRuns.push({
    _id: "execution_modern",
    userId: "user_1",
    runKey: "presentation:project_1",
    generationJobId: "job_1",
    domainType: "presentation",
    domainId: "project_1",
    kind: "presentation",
    state: "running",
    requestedPlacement: "cloud",
    activeAttemptId: "attempt_modern",
    nextAttemptNumber: 2,
    nextFence: 8,
    nextEventSequence: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  rows.executionAttempts.push({
    _id: "attempt_modern",
    runId: "execution_modern",
    userId: "user_1",
    attemptNumber: 1,
    executorKind: "convex_workflow",
    placement: "cloud",
    adapterId: "convex-workflow",
    protocolVersion: "nanthai-execution-v1",
    orchestrationEngine: "convex_workflow",
    status: "running",
    claimantId: "presentation:project_1",
    fence: 7,
    leaseExpiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 1,
  });

  const adopted = await adoptLegacyPresentationExecutionHandler(
    mutationContext(rows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  );
  assert.equal(adopted, null);
  assert.equal(rows.executionRuns.length, 1);
  assert.equal(rows.executionAttempts.length, 1);
});

test("partial or Workflow-owned presentation links fail closed", async () => {
  const partialRows = oldPresentationRows();
  partialRows.presentationGenerationRuns[0].executionAttemptId = "attempt_partial";
  assert.equal(await adoptLegacyPresentationExecutionHandler(
    mutationContext(partialRows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  ), null);
  assert.equal(partialRows.executionRuns.length, 0);

  const workflowRows = oldPresentationRows();
  workflowRows.presentationProjects[0].workflowId = "workflow_1";
  assert.equal(await adoptLegacyPresentationExecutionHandler(
    mutationContext(workflowRows),
    { runId: "run_1" as Id<"presentationGenerationRuns"> },
  ), null);
  assert.equal(workflowRows.executionRuns.length, 0);
});

test("action contexts overlay adopted identity while supplied fences stay strict", async () => {
  const run = oldPresentationRows().presentationGenerationRuns[0] as unknown as
    Doc<"presentationGenerationRuns">;
  const adopted = {
    executionRunId: "execution_legacy" as Id<"executionRuns">,
    executionAttemptId: "attempt_legacy" as Id<"executionAttempts">,
    executionFence: 3,
  };
  let adoptionCalls = 0;
  const adoptionContext = {
    runMutation: async () => {
      adoptionCalls += 1;
      return adopted;
    },
  } as unknown as ActionCtx;
  const resolved = await resolvePresentationActionContext(
    adoptionContext,
    {},
    async () => ({ run, marker: "loaded" }),
  );
  assert.equal(adoptionCalls, 1);
  assert.equal(resolved?.run.executionRunId, adopted.executionRunId);
  assert.equal(resolved?.run.executionAttemptId, adopted.executionAttemptId);
  assert.equal(resolved?.run.executionFence, adopted.executionFence);

  const suppliedRun = { ...run, ...adopted } as Doc<"presentationGenerationRuns">;
  const strictContext = {
    runMutation: async () => assert.fail("supplied identity must not be adopted"),
  } as unknown as ActionCtx;
  const strict = await resolvePresentationActionContext(
    strictContext,
    adopted,
    async () => ({ run: suppliedRun }),
  );
  assert.equal(strict?.run.executionAttemptId, adopted.executionAttemptId);
  assert.equal(await resolvePresentationActionContext(
    strictContext,
    { ...adopted, executionFence: adopted.executionFence + 1 },
    async () => ({ run: suppliedRun }),
  ), null);

  let loaded = false;
  await assert.rejects(
    resolvePresentationActionContext(
      strictContext,
      { executionAttemptId: adopted.executionAttemptId },
      async () => {
        loaded = true;
        return { run: suppliedRun };
      },
    ),
    /incomplete/i,
  );
  assert.equal(loaded, false);
});
