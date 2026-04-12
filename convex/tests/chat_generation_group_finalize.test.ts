import assert from "node:assert/strict";
import test from "node:test";

import {
  createMaybeFinalizeGroupDepsForTest,
  maybeFinalizeGenerationGroup,
} from "../chat/actions_run_generation_group_finalize";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

test("maybeFinalizeGenerationGroup waits for all generation jobs to become terminal", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "job_1") return { status: "completed" };
      if (args.jobId === "job_2") return { status: "streaming" };
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return true;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push(args);
        return "scheduled_1";
      },
    },
  });

  await maybeFinalizeGenerationGroup(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant_1" as any, "msg_assistant_2" as any],
    generationJobIds: ["job_1" as any, "job_2" as any],
    userId: "user_1",
    searchSessionId: "search_1" as any,
  });

  assert.equal(mutationCalls.length, 0);
  assert.equal(scheduledCalls.length, 0);
});

test("maybeFinalizeGenerationGroup schedules postProcess once and completes mixed successful groups", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "job_1") return { status: "completed" };
      if (args.jobId === "job_2") return { status: "failed" };
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      if ("messageId" in args) {
        return true;
      }
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push(args);
        return "scheduled_1";
      },
    },
  });

  await maybeFinalizeGenerationGroup(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant_1" as any, "msg_assistant_2" as any],
    generationJobIds: ["job_1" as any, "job_2" as any],
    userId: "user_1",
    searchSessionId: "search_1" as any,
  }, createMaybeFinalizeGroupDepsForTest({
    now: () => 999,
  }));

  assert.deepEqual(mutationCalls[0], { messageId: "msg_assistant_1" });
  assert.deepEqual(scheduledCalls[0], {
    chatId: "chat_1",
    userMessageId: "msg_user",
    assistantMessageIds: ["msg_assistant_1", "msg_assistant_2"],
    userId: "user_1",
  });
  assert.deepEqual(mutationCalls[1], {
    sessionId: "search_1",
    patch: {
      status: "completed",
      progress: 100,
      currentPhase: "completed",
      completedAt: 999,
    },
  });
});

test("maybeFinalizeGenerationGroup marks fully cancelled groups as cancelled without postProcess", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "job_1") return { status: "cancelled" };
      if (args.jobId === "job_2") return { status: "cancelled" };
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push(args);
        return "scheduled_1";
      },
    },
  });

  await maybeFinalizeGenerationGroup(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant_1" as any, "msg_assistant_2" as any],
    generationJobIds: ["job_1" as any, "job_2" as any],
    userId: "user_1",
    searchSessionId: "search_1" as any,
  }, createMaybeFinalizeGroupDepsForTest({
    now: () => 555,
  }));

  assert.equal(scheduledCalls.length, 0);
  assert.deepEqual(mutationCalls, [{
    sessionId: "search_1",
    patch: {
      status: "cancelled",
      currentPhase: "cancelled",
      completedAt: 555,
    },
  }]);
});

test("maybeFinalizeGenerationGroup marks failed and timed-out groups as failed without postProcess", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "job_1") return { status: "failed" };
      if (args.jobId === "job_2") return { status: "timedOut" };
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push(args);
        return "scheduled_1";
      },
    },
  });

  await maybeFinalizeGenerationGroup(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant_1" as any, "msg_assistant_2" as any],
    generationJobIds: ["job_1" as any, "job_2" as any],
    userId: "user_1",
    searchSessionId: "search_1" as any,
  }, createMaybeFinalizeGroupDepsForTest({
    now: () => 777,
  }));

  assert.equal(scheduledCalls.length, 0);
  assert.deepEqual(mutationCalls, [{
    sessionId: "search_1",
    patch: {
      status: "failed",
      currentPhase: "failed",
      errorMessage: "All generation participants failed",
      completedAt: 777,
    },
  }]);
});
