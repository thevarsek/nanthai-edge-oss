import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { runGenerationParticipantRuntimeHandler } from "../chat/actions_run_generation_participant_runtime";
import {
  clearFreshRuntimeContinuation,
  mapBatchTerminalStatus,
  requiresNodeWorker,
} from "../chat/actions_run_generation_participant_runtime";
import { buildRuntimeBaseToolRegistry } from "../tools/progressive_registry_runtime";
import {
  classifyProfileRuntimeSafety,
  classifyToolRuntimeSafety,
} from "../tools/runtime_safety";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import { OPENROUTER_ACTION_BUDGET_MS } from "../lib/openrouter_constants";

function baseRuntimeArgs(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    generationJobIds: ["job_1" as any],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "msg_assistant" as any,
      jobId: "job_1" as any,
    } as any,
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    directToolNames: [],
    isPro: true,
    allowSubagents: false,
    resumeExpected: false,
    ...overrides,
  };
}

test("buildRuntimeBaseToolRegistry exposes only the always-on runtime-safe base tools", () => {
  const registry = buildRuntimeBaseToolRegistry({ isPro: true });

  assert.ok(registry.get("fetch_image"));
  assert.ok(registry.get("search_chats"));
  assert.ok(registry.get("load_skill"));
  assert.ok(registry.get("list_skills"));
  assert.equal(registry.get("spawn_subagents"), undefined);
  assert.equal(registry.get("workspace_exec"), undefined);
  assert.equal(registry.get("generate_docx"), undefined);
});

test("buildRuntimeBaseToolRegistry exposes spawn_subagents for subagent-enabled turns", () => {
  const registry = buildRuntimeBaseToolRegistry({
    isPro: true,
    allowSubagents: true,
  });

  assert.ok(registry.get("spawn_subagents"));
});

test("runtime safety classification stays conservative", () => {
  assert.equal(classifyToolRuntimeSafety("load_skill"), "runtime-safe");
  assert.equal(classifyToolRuntimeSafety("workspace_exec"), "node-required");
  assert.equal(classifyProfileRuntimeSafety("docs"), "node-required");
  assert.equal(classifyProfileRuntimeSafety("workspace"), "node-required");
});

test("mapBatchTerminalStatus maps all status combinations correctly", () => {
  assert.equal(mapBatchTerminalStatus("cancelled", "streaming"), "cancelled");
  assert.equal(mapBatchTerminalStatus("streaming", "cancelled"), "cancelled");
  assert.equal(mapBatchTerminalStatus("failed", "streaming"), "failed");
  assert.equal(mapBatchTerminalStatus("streaming", "failed"), "failed");
  assert.equal(mapBatchTerminalStatus("streaming", "timedOut"), "failed");
  assert.equal(mapBatchTerminalStatus("completed", "completed"), "completed");
  assert.equal(mapBatchTerminalStatus(undefined, undefined), "completed");
  assert.equal(mapBatchTerminalStatus("streaming", "streaming"), "completed");
});

test("fresh V8 rounds clear stale continuations before a new handoff can be saved", async () => {
  const calls: string[] = [];
  let releaseClear: (() => void) | undefined;
  const clearFinished = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  const ctx = createMockCtx({
    runMutation: async () => {
      calls.push("clear-started");
      await clearFinished;
      calls.push("clear-finished");
    },
  });

  const clearing = clearFreshRuntimeContinuation(ctx, "job_1" as any, false);
  await Promise.resolve();
  assert.deepEqual(calls, ["clear-started"]);
  releaseClear?.();
  await clearing;
  assert.deepEqual(calls, ["clear-started", "clear-finished"]);

  await clearFreshRuntimeContinuation(ctx, "job_1" as any, true);
  assert.deepEqual(calls, ["clear-started", "clear-finished"]);
});

test("requiresNodeWorker returns true for media generation, node tools, or node profiles", () => {
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: true, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: true,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
    hasImageGeneration: true,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: ["workspace_exec"], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: ["list_documents", "read_document", "find_in_document"], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: ["docs"], hasVideoGeneration: false, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), false);
  assert.equal(requiresNodeWorker({
    directToolNames: ["fetch_image", "search_chats"], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), false);
  assert.equal(requiresNodeWorker({
    directToolNames: ["spawn_subagents"], activeProfiles: ["subagents"], hasVideoGeneration: false, hasAudioOutput: false,
  }), false);
});

test("runGenerationParticipantRuntimeHandler delegates to Node when continuation has node-required profiles", async () => {
  const delegatedArgs: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args && Object.keys(args).length === 1) {
        return {
          activeProfiles: ["docs"],
        };
      }
      if ("modelId" in args) {
        return {
          hasVideoGeneration: false,
          hasAudioOutput: false,
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      delegatedArgs.push(args);
      return undefined;
    },
  });

  await runGenerationParticipantRuntimeHandler(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    generationJobIds: ["job_1" as any],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "msg_assistant" as any,
      jobId: "job_1" as any,
    } as any,
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    directToolNames: [],
    isPro: true,
    allowSubagents: false,
    resumeExpected: true,
  });

  assert.equal(delegatedArgs.length, 1);
  assert.equal(delegatedArgs[0]?.userId, "user_1");
  assert.equal((delegatedArgs[0]?.participant as Record<string, unknown>)?.jobId, "job_1");
});

test("runGenerationParticipantRuntimeHandler delegates direct node-required runtime work", async () => {
  const delegatedArgs: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return {
          hasVideoGeneration: true,
          hasAudioOutput: false,
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      delegatedArgs.push(args);
    },
  });

  await runGenerationParticipantRuntimeHandler(
    ctx,
    baseRuntimeArgs({ directToolNames: ["workspace_exec"], enqueuedAt: Date.now() - 5 }),
  );

  assert.equal(delegatedArgs.length, 1);
});

test("fresh Drive resumes re-derive document tools from the picked attachment", async () => {
  const delegatedArgs: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return { hasVideoGeneration: false, hasAudioOutput: false };
      }
      if ("messageId" in args) {
        return {
          attachments: [{
            type: "document",
            name: "The Founders Playbook.pdf",
            mimeType: "application/pdf",
            storageId: "storage_pdf_1",
          }],
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      delegatedArgs.push(args);
    },
  });

  await runGenerationParticipantRuntimeHandler(ctx, baseRuntimeArgs({
    drivePickerBatchId: "drive_batch_1" as any,
    directToolNames: [],
  }));

  assert.equal(delegatedArgs.length, 1);
  assert.deepEqual(delegatedArgs[0]?.directToolNames, [
    "list_documents",
    "read_document",
    "find_in_document",
  ]);
});

test("runtime delegation preserves the provider deadline anchored before delayed routing preflight", async (t) => {
  t.after(() => mock.restoreAll());
  let now = 1_000;
  mock.method(Date, "now", () => now);
  const delegatedArgs: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        now = 91_000;
        return { hasVideoGeneration: true, hasAudioOutput: false };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      delegatedArgs.push(args);
    },
  });

  await runGenerationParticipantRuntimeHandler(ctx, baseRuntimeArgs());

  assert.equal(
    delegatedArgs[0]?.providerDeadlineAt,
    1_000 + OPENROUTER_ACTION_BUDGET_MS,
  );
  assert.equal(now, 91_000);
});

test("runGenerationParticipantRuntimeHandler terminally fails an active job when the Node worker times out", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let jobQueries = 0;
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return { hasVideoGeneration: true, hasAudioOutput: false };
      }
      if ("jobId" in args) {
        jobQueries += 1;
        return { status: jobQueries === 1 ? "streaming" : "failed" };
      }
      if ("messageId" in args) return { status: "failed" };
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async () => {
      throw new Error("Your request couldn't be completed. Try again later.");
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  });

  await assert.rejects(
    runGenerationParticipantRuntimeHandler(ctx, baseRuntimeArgs()),
    /couldn't be completed/,
  );

  assert.ok(mutations.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) => args.jobId === "job_1"));
});

test("runGenerationParticipantRuntimeHandler fails when expected continuation cannot be claimed", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  let jobQueryCount = 0;
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args && Object.keys(args).length === 1) {
        jobQueryCount += 1;
        return null;
      }
      if ("modelId" in args) {
        return {
          hasVideoGeneration: false,
          hasAudioOutput: false,
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return null;
    },
  });

  await assert.rejects(
    runGenerationParticipantRuntimeHandler(
      ctx,
      baseRuntimeArgs({ resumeExpected: true }),
    ),
    /GENERATION_CONTINUATION_NOT_CLAIMABLE/,
  );

  assert.equal(jobQueryCount, 1);
  assert.deepEqual(mutationCalls, [{ jobId: "job_1" }]);
});

test("runGenerationParticipantRuntimeHandler clears continuations for missing and terminal jobs", async () => {
  for (const job of [null, { status: "completed" }, { status: "timedOut" }]) {
    const scheduled: Array<Record<string, unknown>> = [];
    const ctx = createMockCtx({
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("modelId" in args) {
          return {
            hasVideoGeneration: false,
            hasAudioOutput: false,
          };
        }
        if ("jobId" in args) {
          return job;
        }
        throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
          return "sched_1";
        },
        runAt: async () => "unused",
      },
    });

    await runGenerationParticipantRuntimeHandler(ctx, baseRuntimeArgs());

    assert.deepEqual(scheduled, [{ jobId: "job_1" }]);
  }
});

test("runGenerationParticipantRuntimeHandler finalizes setup failures and related batches", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const jobStatuses = ["queued", "streaming", "failed", "failed"];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return {
          hasVideoGeneration: false,
          hasAudioOutput: false,
          supportedParameters: [],
          contextLength: 1024,
        };
      }
      if ("jobId" in args) {
        return { status: jobStatuses.shift() ?? "failed" };
      }
      if ("messageId" in args) {
        return { status: "failed" };
      }
      if ("userId" in args) {
        return null;
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "sched_1";
      },
      runAt: async () => "unused",
    },
  });

  await assert.rejects(
    runGenerationParticipantRuntimeHandler(
      ctx,
      baseRuntimeArgs({
        subagentBatchId: "batch_1" as any,
        drivePickerBatchId: "drive_batch_1" as any,
        searchSessionId: "search_1" as any,
      }),
    ),
    /OpenRouter API key/,
  );

  assert.equal(scheduled.some((args) => args.jobId === "job_1"), false);
  assert.ok(mutations.some((args) =>
    args.jobId === "job_1" && Object.keys(args).length === 1
  ));
  assert.ok(mutations.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) =>
    args.batchId === "batch_1"
    && args.expectedCurrentStatus === "resuming"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) =>
    args.batchId === "drive_batch_1"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) =>
    args.sessionId === "search_1"
    && (args.patch as any)?.status === "failed"
  ));
});

test("fresh Drive resumes continue generation when start analytics were already recorded", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let jobOnlyMutationCount = 0;
  let jobStatus = "queued";
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return { hasVideoGeneration: false, hasAudioOutput: false };
      }
      if ("jobId" in args) return { status: jobStatus };
      if ("messageId" in args) return { status: "failed" };
      if ("userId" in args) return null;
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.jobId === "job_1" && args.status === "streaming") {
        jobStatus = "streaming";
      }
      if (args.jobId === "job_1" && Object.keys(args).length === 1) {
        jobOnlyMutationCount += 1;
        // The second job-only mutation is the analytics start marker. A Drive
        // resume legitimately sees it already set by the pre-picker round.
        if (jobOnlyMutationCount === 2) return false;
      }
      return undefined;
    },
  });

  await assert.rejects(
    runGenerationParticipantRuntimeHandler(
      ctx,
      baseRuntimeArgs({ drivePickerBatchId: "drive_batch_1" as any }),
    ),
    /OpenRouter API key/,
  );

  assert.ok(mutations.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
  ));
});
