import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelResearchPaperHandler,
  cancellationPlaceholderForMode,
  scheduleLegacyResearchWorkflowCancellation,
} from "../search/mutations_research_paper";
import { closeRunWriterForCancellation } from "../execution/cancel_fence";
import { isCurrentResearchExecution } from "../search/execution_lifecycle";

test("cancellationPlaceholderForMode returns mode-specific placeholder text", () => {
  assert.equal(cancellationPlaceholderForMode("paper"), "[Research paper cancelled]");
  assert.equal(cancellationPlaceholderForMode("web"), "[Web search cancelled]");
  assert.equal(cancellationPlaceholderForMode(undefined), "[Generation cancelled]");
});

test("research cancellation directly cancels only legacy-owned Workflows", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any;

  assert.equal(await scheduleLegacyResearchWorkflowCancellation(ctx, {
    executionRunId: "run_1" as any,
    workflowId: "workflow_modern",
  }), false);
  assert.equal(await scheduleLegacyResearchWorkflowCancellation(ctx, {
    workflowId: "workflow_legacy",
  }), true);
  assert.deepEqual(scheduled, [{ workflowId: "workflow_legacy" }]);
});

test("cancelResearchPaperHandler uses web placeholder for cancelled web sessions", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const session = {
    _id: "session_1",
    userId: "user_1",
    assistantMessageId: "message_1",
    status: "searching",
    mode: "web" as const,
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "session_1") return session;
        if (id === "message_1") {
          return { _id: "message_1", status: "streaming", content: "" };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      query: (table: string) => {
        assert.equal(table, "generationJobs");
        return {
          withIndex: (_index: string, _cb: unknown) => ({
            collect: async () => [
              { _id: "job_active", status: "streaming" },
              { _id: "job_done", status: "completed" },
            ],
          }),
        };
      },
    },
  } as any;

  await cancelResearchPaperHandler(ctx, { sessionId: "session_1" as any });

  const sessionPatch = patches.find((entry) => entry.id === "session_1");
  assert.ok(sessionPatch);
  assert.equal(sessionPatch.patch.status, "cancelled");

  const messagePatch = patches.find((entry) => entry.id === "message_1");
  assert.ok(messagePatch);
  assert.equal(messagePatch.patch.status, "cancelled");
  assert.equal(messagePatch.patch.content, "[Web search cancelled]");

  const activeJobPatch = patches.find((entry) => entry.id === "job_active");
  assert.ok(activeJobPatch);
  assert.equal(activeJobPatch.patch.status, "cancelled");

  const completedJobPatch = patches.find((entry) => entry.id === "job_done");
  assert.equal(completedJobPatch, undefined);
});

test("cancelResearchPaperHandler preserves existing assistant content when cancelling", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "session_2") {
          return {
            _id: "session_2",
            userId: "user_1",
            assistantMessageId: "message_2",
            status: "writing",
            mode: "paper",
          };
        }
        if (id === "message_2") {
          return {
            _id: "message_2",
            status: "streaming",
            content: "Partially streamed answer",
          };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => [],
        }),
      }),
    },
  } as any;

  await cancelResearchPaperHandler(ctx, { sessionId: "session_2" as any });

  const messagePatch = patches.find((entry) => entry.id === "message_2");
  assert.ok(messagePatch);
  assert.equal(messagePatch.patch.content, "Partially streamed answer");
});

test("research cancellation closes the writer before a normal handoff can complete", async () => {
  const rows = new Map<string, Record<string, unknown>>([
    ["run_1", {
      _id: "run_1",
      activeAttemptId: "attempt_1",
      state: "running",
      userId: "user_1",
    }],
    ["attempt_1", {
      _id: "attempt_1",
      runId: "run_1",
      status: "running",
      fence: 7,
      claimantId: "research-workflow:workflow_1",
    }],
  ]);
  const db = {
    get: async (id: string) => rows.get(id) ?? null,
    patch: async (id: string, patch: Record<string, unknown>) => {
      rows.set(id, { ...rows.get(id), ...patch });
    },
  } as any;
  await closeRunWriterForCancellation(
    { db } as any,
    "run_1" as any,
    "user_1",
    "Research paper cancelled by user",
    123,
  );
  assert.equal(rows.get("run_1")?.state, "cancelling");

  const current = await isCurrentResearchExecution({ db }, {
    _id: "session_1",
    status: "writing",
    executionRunId: "run_1",
    executionAttemptId: "attempt_1",
    executionFence: 7,
    executionClaimantId: "research-workflow:workflow_1",
    generationHandoffOperationId: "generation_workflow_1",
  } as any, {
    executionAttemptId: "attempt_1" as any,
    executionFence: 7,
  }, true);
  assert.equal(current, false);
});
