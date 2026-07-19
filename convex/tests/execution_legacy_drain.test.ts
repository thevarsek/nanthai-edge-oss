import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import {
  inspectLegacyOrchestrationDrain,
  LEGACY_DRAIN_SOURCE_SAMPLE_LIMIT,
} from "../execution/legacy_drain";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

function inspect(rows: Record<string, Array<Record<string, unknown>>>) {
  return inspectLegacyOrchestrationDrain(
    createStatefulMockCtx(rows) as unknown as QueryCtx,
  );
}

test("legacy drain inspects lifecycle rows beyond execution attempts", async () => {
  const state = await inspect({
    generationJobs: [{
      _id: "job_1",
      status: "streaming",
      executionAttemptId: "attempt_1",
      scheduledFunctionId: "scheduled_generation",
    }],
    generationContinuations: [{
      _id: "continuation_1",
      status: "waiting",
      scheduledFunctionId: "scheduled_continuation",
    }],
    advisorRuns: [{
      _id: "advisor_1",
      status: "consulting",
      workpoolOperationId: "work_legacy_watchdog",
      watchdogScheduledFunctionId: "scheduled_advisor_watchdog",
    }],
    subagentBatches: [{
      _id: "subagent_batch_1",
      status: "waiting_to_resume",
    }],
    presentationGenerationRuns: [{
      _id: "presentation_run_1",
      status: "curating",
      executionAttemptId: "attempt_2",
      workflowId: "workflow_2",
      curatorScheduledFunctionId: "scheduled_curator",
    }],
    researchSearchTasks: [{
      _id: "research_task_1",
      status: "queued",
    }],
    scheduledJobs: [{
      _id: "scheduled_job_1",
      activeExecutionId: "legacy_execution",
    }],
  });
  assert.equal(state.hasActiveLegacy, true);
  assert.equal(state.drainComplete, false);
  for (const source of [
    "generationJobs",
    "generationContinuations",
    "advisorRuns",
    "subagentBatches",
    "presentationGenerationRuns",
    "researchSearchTasks",
    "scheduledJobs",
  ]) {
    assert.ok(
      state.sources.find((entry) => entry.source === source)?.sampledActiveLegacy,
      `${source} should block legacy removal`,
    );
  }
});

test("legacy drain accepts active rows only when durable ownership is explicit", async () => {
  const state = await inspect({
    generationJobs: [{
      _id: "job_1",
      status: "streaming",
      executionAttemptId: "attempt_1",
    }],
    generationContinuations: [{
      _id: "continuation_1",
      status: "running",
      executionAttemptId: "attempt_1",
    }],
    advisorBatches: [{
      _id: "advisor_batch_1",
      status: "running",
      workflowId: "workflow_1",
      executionAttemptId: "attempt_2",
    }],
    advisorRuns: [{
      _id: "advisor_1",
      status: "streaming",
      workpoolOperationId: "work_1",
    }],
    subagentBatches: [{
      _id: "subagent_batch_1",
      status: "running_children",
      workflowResumeEventId: "event_1",
    }],
    subagentRuns: [{
      _id: "subagent_1",
      status: "streaming",
      workflowId: "workflow_2",
    }],
    presentationGenerationBatches: [{
      _id: "presentation_batch_1",
      status: "running",
      workpoolOperationId: "work_2",
    }],
    researchSearchTasks: [{
      _id: "research_task_1",
      status: "queued",
      workpoolOperationId: "work_3",
    }],
    scheduledJobs: [{
      _id: "scheduled_job_1",
      activeExecutionId: "execution_1",
      activeWorkflowId: "workflow_3",
      executionAttemptId: "attempt_3",
    }],
  });
  assert.equal(state.sampledActiveLegacy, 0);
  assert.equal(state.inspectionComplete, true);
  assert.equal(state.drainComplete, true);
});

test("legacy drain never declares zero when a source sample is capped", async () => {
  const scheduledJobs = Array.from({ length: LEGACY_DRAIN_SOURCE_SAMPLE_LIMIT + 1 }, (_, index) => ({
    _id: `scheduled_job_${index}`,
    activeExecutionId: `execution_${index}`,
    activeWorkflowId: `workflow_${index}`,
    executionAttemptId: `attempt_${index}`,
  }));
  const state = await inspect({ scheduledJobs });
  assert.equal(state.hasActiveLegacy, false);
  assert.equal(state.sampleCapped, true);
  assert.equal(state.inspectionComplete, false);
  assert.equal(state.drainComplete, false);
  assert.equal(
    state.sources.find((source) => source.source === "scheduledJobs")?.sampleCapped,
    true,
  );
});
