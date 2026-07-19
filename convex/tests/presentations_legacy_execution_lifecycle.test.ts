import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { failPresentationFanoutHandler } from
  "../presentations/generation_studio_mutation_handlers";
import { finalizePresentationFanoutHandler } from
  "../presentations/generation_finalization_handler";
import {
  adoptLegacyPresentationExecutionHandler,
  cancelAdoptedLegacyPresentationExecutionHandler,
} from "../presentations/legacy_execution_adoption";
import {
  oldPresentationRows,
  presentationMutationContext,
} from "../../test_helpers/presentation_legacy_fixture";

const runId = "run_1" as Id<"presentationGenerationRuns">;

function validSlideHtml(): string {
  return '<section class="slide-root" style="position:relative;width:1280px;' +
    'height:720px;overflow:hidden"><h1 data-element-id="title" ' +
    'style="position:absolute;left:80px;top:80px;width:900px;height:120px;' +
    'font-size:42px;line-height:52px">Legacy presentation</h1></section>';
}

test("adopted legacy execution completes with its presentation transaction", async () => {
  const rows = oldPresentationRows();
  rows.presentationGenerationRuns[0].status = "finalizing";
  rows.presentationGenerationRuns[0].completedSlideIds = ["slide_1"];
  rows.presentationSlideCandidates = [{
    _id: "candidate_1",
    runId: "run_1",
    userId: "user_1",
    slideId: "slide_1",
    position: 0,
    title: "Opening",
    html: validSlideHtml(),
    effectiveModelId: "openai/gpt-5",
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  }];
  rows.presentationSlides = [];
  rows.presentationGenerationBatches = [];
  rows.presentationCuratorTasks = [];
  const ctx = presentationMutationContext(rows);
  const adopted = await adoptLegacyPresentationExecutionHandler(ctx, { runId });
  assert.ok(adopted);

  const finalized = await finalizePresentationFanoutHandler(ctx, {
    runId,
    executionAttemptId: adopted.executionAttemptId,
    executionFence: adopted.executionFence,
  });

  assert.equal(finalized?.slideCount, 1);
  assert.equal(rows.presentationGenerationRuns[0].status, "complete");
  assert.equal(rows.presentationProjects[0].status, "ready");
  assert.equal(rows.executionRuns[0].state, "completed");
  assert.equal(rows.executionRuns[0].terminalOutcome, "completed");
  assert.equal(rows.executionAttempts[0].status, "completed");
  assert.equal(rows.executionAttempts[0].leaseExpiresAt, undefined);
});

test("adopted legacy execution fails with its presentation transaction", async () => {
  const rows = oldPresentationRows();
  rows.presentationGenerationBatches = [];
  rows.presentationSlideCandidates = [];
  rows.presentationCuratorTasks = [];
  const ctx = presentationMutationContext(rows);
  const adopted = await adoptLegacyPresentationExecutionHandler(ctx, { runId });
  assert.ok(adopted);

  assert.equal(await failPresentationFanoutHandler(ctx, {
    runId,
    executionAttemptId: adopted.executionAttemptId,
    executionFence: adopted.executionFence,
    error: "Legacy studio failed",
  }), true);

  assert.equal(rows.presentationGenerationRuns[0].status, "failed");
  assert.equal(rows.presentationProjects[0].status, "failed");
  assert.equal(rows.executionRuns[0].state, "failed");
  assert.equal(rows.executionRuns[0].terminalOutcome, "failed");
  assert.equal(rows.executionAttempts[0].status, "failed");
  assert.equal(rows.executionAttempts[0].errorSummary, "Legacy studio failed");
});

test("a terminal parent cancels its adopted legacy execution", async () => {
  const rows = oldPresentationRows();
  rows.presentationGenerationBatches = [];
  rows.presentationSlideCandidates = [];
  rows.presentationCuratorTasks = [];
  const ctx = presentationMutationContext(rows);
  const adopted = await adoptLegacyPresentationExecutionHandler(ctx, { runId });
  assert.ok(adopted);
  rows.generationJobs[0].status = "cancelled";

  assert.equal(await cancelAdoptedLegacyPresentationExecutionHandler(ctx, {
    runId,
    executionAttemptId: adopted.executionAttemptId,
    executionFence: adopted.executionFence,
  }), true);

  assert.equal(rows.presentationGenerationRuns[0].status, "failed");
  assert.equal(rows.presentationProjects[0].status, "failed");
  assert.equal(rows.executionRuns[0].state, "cancelled");
  assert.equal(rows.executionRuns[0].terminalOutcome, "cancelled");
  assert.equal(rows.executionAttempts[0].status, "cancelled");
});
