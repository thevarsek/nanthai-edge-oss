import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { scheduleDeferredPresentationWorkflow } from "../presentations/deferred_workflow_scheduler";
import { startPresentationWorkflowRef } from "../presentations/presentation_workflow_refs";
import {
  completeAndResume,
  failAndResume,
} from "../presentations/deferred_workflow_resume";
import {
  MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS,
  MAX_PRESENTATION_WORKFLOW_MODEL_PHASES,
} from "../presentations/limits";

test("deferred presentations reserve every remaining model phase for local layout repair", () => {
  assert.equal(MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS, 3);
  assert.equal(MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS + 2, MAX_PRESENTATION_WORKFLOW_MODEL_PHASES);
});

test("deferred presentation scheduling persists the checkpoint and starts one durable Workflow", async () => {
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const checkpoint = {
    participant: { modelId: "openai/gpt-5", messageId: "message_1", jobId: "job_1" },
    group: {
      assistantMessageIds: ["message_1"],
      generationJobIds: ["job_1"],
      userMessageId: "user_message_1",
      userId: "user_1",
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      effectiveIntegrations: [],
      directToolNames: ["create_presentation"],
      isPro: true,
      allowSubagents: false,
    },
    messages: [{ role: "tool", tool_call_id: "call_1", content: "{\"status\":\"generating\"}" }],
    toolCalls: [{ id: "call_1", name: "create_presentation", arguments: "{}" }],
    toolResults: [{
      toolCallId: "call_1",
      toolName: "create_presentation",
      result: "{\"status\":\"generating\"}",
    }],
    activeProfiles: ["docs"],
    loadedSkills: [],
    compactionCount: 0,
    continuationCount: 1,
  };
  const args = {
    chatId: "chat_1",
    userMessageId: "user_message_1",
    assistantMessageIds: ["message_1"],
    generationJobIds: ["job_1"],
    participant: { modelId: "openai/gpt-5", messageId: "message_1", jobId: "job_1" },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: false,
    workflowManaged: true,
    workflowResumeEventId: "event_1",
  } as never;
  const ctx = {
    runMutation: async (ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutations.push({ name: getFunctionName(ref as never), args: mutationArgs });
      return "workflow_1";
    },
  } as never;

  await scheduleDeferredPresentationWorkflow(ctx, args, checkpoint as never, {
    projectId: "project_1" as never,
    toolCallId: "call_1",
  });

  assert.equal(mutations[0]?.args.jobId, "job_1");
  assert.deepEqual(mutations[0]?.args.checkpoint, {
    ...checkpoint,
    deferredResumeEventId: "event_1",
    roundKey: "event_1",
    deferredOwnership: {
      kind: "presentation",
      projectId: "project_1",
      toolCallId: "call_1",
      modelId: "openai/gpt-5",
    },
  });
  assert.equal(mutations[1]?.name, getFunctionName(startPresentationWorkflowRef));
  assert.equal(mutations[1]?.args.workflowResumeEventId, "event_1");
});

test("deferred presentation scheduling rejects a missing parent Workflow event", async () => {
  const ctx = {
    runMutation: async () => {
      throw new Error("must not persist or start");
    },
  } as never;
  const args = {
    chatId: "chat_1",
    userMessageId: "user_message_1",
    assistantMessageIds: ["message_1"],
    generationJobIds: ["job_1"],
    participant: { modelId: "openai/gpt-5", messageId: "message_1", jobId: "job_1" },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: false,
    workflowManaged: true,
  } as never;

  await assert.rejects(
    scheduleDeferredPresentationWorkflow(ctx, args, {} as never, {
      projectId: "project_1" as never,
      toolCallId: "call_1",
    }),
    /PRESENTATION_PARENT_WORKFLOW_EVENT_REQUIRED/,
  );
});

test("deferred presentation completion rejects a missing parent Workflow event", async () => {
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.includes("getGenerationJobInternal")) {
        return {
          _id: "job_1",
          userId: "user_1",
          status: "streaming",
        };
      }
      if (name.includes("getProjectInternal")) return null;
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async () => {
      throw new Error("must not resume");
    },
  } as never;

  await assert.rejects(failAndResume(ctx, {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
  } as never, new Error("Slide geometry failed validation.")),
  /PRESENTATION_PARENT_WORKFLOW_EVENT_REQUIRED/);
});

test("Workflow-owned presentation completion updates the deferred tool before signaling", async () => {
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.includes("getGenerationContinuationInternal")) {
        return { userId: "user_1" };
      }
      if (name.includes("getGenerationJobInternal")) {
        return {
          _id: "job_1",
          userId: "user_1",
          status: "streaming",
        };
      }
      if (name.includes("getProjectInternal")) {
        return { _id: "project_1", parentResumeEventId: "event_rebound" };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ name: getFunctionName(ref as never), args });
      return "resumed";
    },
  } as never;

  await completeAndResume(ctx, {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
    workflowResumeEventId: "event_1",
  } as never, {
    success: true,
    data: { presentationProjectId: "project_1", presentationRevision: 4 },
  });

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.name, "chat/workflow_events:completeDeferredTool");
  assert.equal(mutations[0]?.args.eventId, "event_rebound");
  assert.equal(mutations[0]?.args.toolCallId, "call_1");
  assert.ok(!("isError" in (mutations[0]?.args ?? {})));
});

test("Workflow-owned presentation completion rejects a missing parent checkpoint", async () => {
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.includes("getGenerationContinuationInternal")) {
        return { userId: "user_1" };
      }
      if (name.includes("getGenerationJobInternal")) {
        return { _id: "job_1", userId: "user_1", status: "streaming" };
      }
      if (name.includes("getProjectInternal")) {
        return { _id: "project_1", parentResumeEventId: "event_rebound" };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async () => "missing",
  } as never;

  await assert.rejects(completeAndResume(ctx, {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
    workflowResumeEventId: "event_old",
  } as never, {
    success: true,
    data: { presentationProjectId: "project_1", presentationRevision: 4 },
  }), /PRESENTATION_PARENT_CHECKPOINT_NOT_FOUND/);
});
