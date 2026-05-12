import assert from "node:assert/strict";
import test from "node:test";

import { continueParentAfterSubagentsHandler } from "../subagents/actions_continue_parent";
import { SUBAGENT_RECOVERY_LEASE_MS } from "../subagents/shared";

function staleBatch() {
  return {
    _id: "batch_1",
    status: "resuming",
    updatedAt: Date.now() - SUBAGENT_RECOVERY_LEASE_MS - 1_000,
    parentMessageId: "parent_msg_1",
    sourceUserMessageId: "user_msg_1",
    parentJobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    resumeConversationSeed: [],
    toolCallId: "tool_1",
    participantSnapshot: {
      chatId: "chat_1",
      userId: "user_1",
      participant: { modelId: "openai/gpt-4o" },
    },
    paramsSnapshot: {},
  };
}

test("continueParentAfterSubagentsHandler reconciles stale completed resumes and attaches child artifacts", async () => {
  const runMutationCalls: Array<Record<string, unknown>> = [];
  let batchQueryCount = 0;
  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);
      if ("batchId" in args && !("status" in args) && !("generatedFiles" in args)) {
        return false;
      }
      return true;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("batchId" in args) {
        batchQueryCount += 1;
        if (batchQueryCount === 1) return staleBatch();
        return [
          {
            generatedFiles: [{
              storageId: "storage_file_1",
              filename: "brief.md",
              mimeType: "text/markdown",
              toolName: "generate_text_file",
            }],
            generatedCharts: [{
              toolName: "chart",
              chartType: "bar",
              title: "Summary",
              elements: [{ label: "A", value: 1 }],
            }],
          },
        ];
      }
      if ("messageId" in args) return { _id: "parent_msg_1", status: "completed" };
      if ("jobId" in args) return { _id: "job_1", status: "streaming" };
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    scheduler: { runAfter: async () => "sched_1" },
  } as any;

  await continueParentAfterSubagentsHandler(ctx, { batchId: "batch_1" } as any);

  assert.ok(runMutationCalls.some((call) =>
    call.messageId === "parent_msg_1"
      && Array.isArray(call.generatedFiles)
      && call.generatedFiles.length === 1));
  assert.ok(runMutationCalls.some((call) =>
    call.messageId === "parent_msg_1"
      && Array.isArray(call.generatedCharts)
      && call.generatedCharts.length === 1));
  assert.ok(runMutationCalls.some((call) =>
    call.batchId === "batch_1" && call.status === "completed"));
});

test("continueParentAfterSubagentsHandler fails stale non-terminal resumes with preserved or fallback content", async () => {
  async function runCase(parentContent: string | undefined) {
    const mutationCalls: Array<Record<string, unknown>> = [];
    let batchQueryCount = 0;
    const ctx = {
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutationCalls.push(args);
        if ("batchId" in args && !("status" in args)) return false;
        return true;
      },
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
        if ("batchId" in args) {
          batchQueryCount += 1;
          return batchQueryCount === 1 ? staleBatch() : [];
        }
        if ("messageId" in args) {
          return { _id: "parent_msg_1", status: "streaming", content: parentContent };
        }
        if ("jobId" in args) return { _id: "job_1", status: "streaming" };
        throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
      },
      scheduler: { runAfter: async () => "sched_1" },
    } as any;

    await continueParentAfterSubagentsHandler(ctx, { batchId: "batch_1" } as any);
    return mutationCalls;
  }

  const preserved = await runCase("Partial parent answer");
  assert.ok(preserved.some((call) =>
    call.messageId === "parent_msg_1"
      && call.status === "failed"
      && call.content === "Partial parent answer"));

  const fallback = await runCase("   ");
  assert.ok(fallback.some((call) =>
    call.messageId === "parent_msg_1"
      && call.status === "failed"
      && call.content === "Error: Subagent resume interrupted."));
});
