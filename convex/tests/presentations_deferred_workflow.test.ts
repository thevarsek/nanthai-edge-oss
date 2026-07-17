import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { scheduleDeferredPresentationWorkflow } from "../presentations/deferred_workflow_scheduler";
import {
  type DeferredPresentationRepairArgs,
  expireDeferredPresentationRef,
  presentationWorkflowArgs,
  runDeferredPresentationPlanRef,
} from "../presentations/deferred_workflow_refs";
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

test("deferred presentation scheduling persists the checkpoint and starts fresh phase actions", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<{ delay: number; name: string; args: Record<string, unknown> }> = [];
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
  } as never;
  const ctx = {
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutations.push(mutationArgs);
    },
    scheduler: {
      runAfter: async (delay: number, ref: unknown, phaseArgs: Record<string, unknown>) => {
        scheduled.push({ delay, name: getFunctionName(ref as never), args: phaseArgs });
        return `scheduled_${scheduled.length}`;
      },
    },
  } as never;

  await scheduleDeferredPresentationWorkflow(ctx, args, checkpoint, {
    projectId: "project_1" as never,
    toolCallId: "call_1",
  });

  assert.equal(mutations[0]?.jobId, "job_1");
  assert.equal(mutations[0]?.checkpoint, checkpoint);
  assert.equal(scheduled[0]?.name, getFunctionName(runDeferredPresentationPlanRef));
  assert.equal(scheduled[0]?.delay, 0);
  assert.equal(scheduled[1]?.name, getFunctionName(expireDeferredPresentationRef));
  assert.ok((scheduled[1]?.delay ?? 0) > 30 * 60 * 1_000);
  assert.equal(mutations[1]?.scheduledFunctionId, "scheduled_1");
});

test("deferred presentation repair transitions strip repair-only action fields", () => {
  const repairArgs: DeferredPresentationRepairArgs = {
    projectId: "project_1" as never,
    userId: "user_1",
    jobId: "job_1" as never,
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
    requireZdrOverride: true,
    invalidResponse: "malformed model output",
    validationError: "slides were invalid",
    candidateStorageId: "candidate_1" as never,
    targetSlideId: "slide_03",
    repairAttempt: 2,
    priorEffectiveModelId: "fallback/model",
  };
  const args = presentationWorkflowArgs(repairArgs);

  assert.deepEqual(args, {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
    requireZdrOverride: true,
  });
  assert.ok(!("invalidResponse" in args));
  assert.ok(!("validationError" in args));
  assert.ok(!("candidateStorageId" in args));
  assert.ok(!("targetSlideId" in args));
  assert.ok(!("repairAttempt" in args));
  assert.ok(!("priorEffectiveModelId" in args));

  const withoutOptionalOverride = presentationWorkflowArgs({
    ...repairArgs,
    requireZdrOverride: undefined,
  });
  assert.ok(!("requireZdrOverride" in withoutOptionalOverride));
});

test("deferred presentation terminalizes when its parent continuation disappeared", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.includes("getGenerationContinuationInternal")) return null;
      if (name.includes("getGenerationJobInternal")) {
        return {
          _id: "job_1",
          chatId: "chat_1",
          messageId: "message_1",
          userId: "user_1",
          status: "streaming",
        };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  } as never;
  const args = {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
  } as never;

  await failAndResume(ctx, args, new Error("Slide geometry failed validation."));
  await completeAndResume(ctx, args, {
    success: true,
    data: {
      storageId: "storage_1",
      filename: "deck.pptx",
      mimeType: "application/pptx",
      sizeBytes: 123,
      toolName: "create_presentation",
      presentationProjectId: "project_1",
      presentationRevision: 4,
    },
  });

  assert.equal(mutations[0]?.status, "failed");
  assert.match(String(mutations[0]?.error), /geometry/);
  assert.equal(mutations[1]?.status, "completed");
  assert.deepEqual(mutations[1]?.generatedFiles, [{
    storageId: "storage_1",
    filename: "deck.pptx",
    mimeType: "application/pptx",
    sizeBytes: 123,
    toolName: "create_presentation",
    title: undefined,
    summary: undefined,
    presentationProjectId: "project_1",
    presentationRevision: 4,
  }]);
});
