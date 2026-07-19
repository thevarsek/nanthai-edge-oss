import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { executeScheduledJobHandler } from "../scheduledJobs/actions_handlers";
import {
  apiOccurrenceId,
  resolveScheduledOccurrenceStart,
  scheduledOccurrenceId,
} from "../scheduledJobs/occurrence";
import { findDomainWorkflowOperation } from "../execution/domain_lifecycle";

test("scheduled entry preserves its persisted occurrence id", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await executeScheduledJobHandler({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
      return "workflow_1";
    },
  } as never, {
    jobId: "job_1" as Id<"scheduledJobs">,
    invocationSource: "scheduled",
    occurrenceId: "scheduled:job_1:1234",
  });
  assert.equal(calls[0]?.occurrenceId, "scheduled:job_1:1234");
});

test("active duplicate occurrences reuse the Workflow while overlaps do not", () => {
  const active = {
    activeExecutionId: "exec_1",
    activeOccurrenceId: "occurrence_1",
    activeWorkflowId: "workflow_1",
  };
  assert.deepEqual(resolveScheduledOccurrenceStart(active, "occurrence_1"), {
    kind: "duplicate",
    workflowId: "workflow_1",
  });
  assert.deepEqual(resolveScheduledOccurrenceStart(active, "occurrence_2"), {
    kind: "overlap",
  });
  assert.deepEqual(resolveScheduledOccurrenceStart({}, "occurrence_1"), {
    kind: "idle",
  });
});

test("post-terminal retries find the original persisted Workflow operation", async () => {
  const run = {
    _id: "run_1",
    userId: "user_1",
    runKey: "scheduled:job_1:occurrence_1",
    state: "completed",
    activeAttemptId: "attempt_1",
  };
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_index: string, apply: (query: any) => unknown) => {
          const query = { eq: () => query };
          apply(query);
          return { unique: async () => run };
        },
      }),
      get: async () => ({ componentOperationId: "workflow_1" }),
    },
  };
  assert.equal(await findDomainWorkflowOperation(
    ctx as never,
    "user_1",
    run.runKey,
  ), "workflow_1");
});

test("recurrence and API occurrence keys are stable", () => {
  assert.equal(
    scheduledOccurrenceId("job_1" as Id<"scheduledJobs">, 1234.9),
    "scheduled:job_1:1234",
  );
  assert.equal(apiOccurrenceId("request_2", "idem_1"), "api:idem_1");
  assert.equal(apiOccurrenceId("request_2"), "api:request_2");
});
