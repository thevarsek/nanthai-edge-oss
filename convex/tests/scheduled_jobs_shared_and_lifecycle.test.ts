import assert from "node:assert/strict";
import test from "node:test";

import {
  handleFailure,
  MAX_CONSECUTIVE_FAILURES,
  scheduleFailureNotification,
  scheduleNextRunIfNeeded,
} from "../scheduledJobs/actions_lifecycle";
import {
  applyTemplateVariables,
  buildPromptWithKB,
  buildStepTriggerPrompt,
  getScheduledJobSteps,
  getStepTitle,
  mirrorFirstStep,
} from "../scheduledJobs/shared";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

test("shared scheduled job helpers normalize legacy and step-based job shapes", () => {
  const legacy = getScheduledJobSteps({
    prompt: "Summarize updates",
    modelId: "openai/gpt-5",
    webSearchEnabled: true,
    searchComplexity: 2.6,
  });

  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.searchMode, "basic");
  assert.equal(legacy[0]?.searchComplexity, 3);

  const steps = getScheduledJobSteps({
    prompt: "ignored",
    modelId: "ignored",
    steps: [
      {
        title: "  Research  ",
        prompt: "Find sources",
        modelId: "openai/gpt-5",
        searchMode: "research",
        searchComplexity: 0.7,
        turnSkillOverrides: [{ skillId: "skill_1" as any, state: "always" }],
        turnIntegrationOverrides: [{ integrationId: "gmail", enabled: true }],
      },
    ],
  });

  assert.equal(steps[0]?.searchMode, "research");
  assert.equal(steps[0]?.searchComplexity, 1);
  assert.deepEqual(steps[0]?.turnSkillOverrides, [{ skillId: "skill_1", state: "always" }]);
  assert.deepEqual(steps[0]?.turnIntegrationOverrides, [{ integrationId: "gmail", enabled: true }]);
  assert.equal(getStepTitle(steps[0]!, 0), "Research");
  assert.equal(
    buildStepTriggerPrompt(steps[0]!, "  Prior answer  "),
    "Find sources\n\n[Previous Step Output]\nPrior answer",
  );
});

test("buildPromptWithKB truncates context and mirrorFirstStep preserves derived defaults", () => {
  const prompt = buildPromptWithKB("Write summary", [
    { storageId: "a", content: "A".repeat(49_990) },
    { storageId: "b", content: "B".repeat(500) },
  ]);

  assert.match(prompt, /^\[Knowledge Base Context\]/);
  assert.match(prompt, /\[Task\]\nWrite summary$/);
  assert.ok(prompt.length < 51_000);

  const mirrored = mirrorFirstStep([
    {
      prompt: "Write summary",
      modelId: "openai/gpt-5",
      searchMode: "web",
      searchComplexity: 1.7,
      includeReasoning: true,
      reasoningEffort: "high",
    },
  ]);

  assert.equal(mirrored.webSearchEnabled, true);
  assert.equal(mirrored.searchMode, "web");
  assert.equal(mirrored.searchComplexity, 2);
  assert.equal(mirrored.includeReasoning, true);
});

test("applyTemplateVariables replaces known placeholders and leaves unknown placeholders literal", () => {
  const rendered = applyTemplateVariables(
    "Summarize {{CONTEXT}} and {{UNKNOWN}}",
    { CONTEXT: "project updates" },
  );
  assert.equal(rendered, "Summarize project updates and {{UNKNOWN}}");
});

test("handleFailure increments failures and auto-pauses at the threshold", async () => {
  const mutationCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];

  const ctx = createMockCtx({
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push({ ref, args });
    },
  });

  await handleFailure(
    ctx,
    "job_1" as any,
    MAX_CONSECUTIVE_FAILURES - 1,
    "boom",
    123,
  );

  assert.equal(mutationCalls.length, 1);
  assert.deepEqual(mutationCalls[0]?.args, {
    jobId: "job_1",
    error: "boom",
    consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    autoPause: true,
    startedAt: 123,
  });
});

test("scheduleFailureNotification truncates the body", async () => {
  const pushCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        pushCalls.push(args);
      },
    },
  });

  await scheduleFailureNotification(ctx, {
    userId: "user_1",
    jobName: "Digest",
    errorMessage: "x".repeat(250),
    chatId: "chat_1",
  });

  assert.equal((pushCalls[0]?.body as string).length, 200);
});

test("scheduleNextRunIfNeeded replaces or updates schedules", async () => {
  const mutations: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const runAtCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    scheduler: {
      runAt: async (nextRunAt: number, _ref: unknown, args: Record<string, unknown>) => {
        runAtCalls.push({ nextRunAt, ...args });
        return "scheduled_new";
      },
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ ref, args });
    },
  });

  await scheduleNextRunIfNeeded(ctx, {
    jobId: "job_1" as any,
    recurrence: { type: "daily", hourUTC: 8, minuteUTC: 30 },
    timezone: "Europe/London",
    status: "active",
    scheduledFunctionId: "scheduled_prev" as any,
    replaceExistingSchedule: true,
  });

  await scheduleNextRunIfNeeded(ctx, {
    jobId: "job_2" as any,
    recurrence: { type: "daily", hourUTC: 9, minuteUTC: 0 },
    timezone: "Europe/London",
    status: "active",
    replaceExistingSchedule: false,
  });

  assert.equal(runAtCalls.length, 2);
  assert.equal(mutations.length, 2);
  assert.equal(mutations[0]?.args.jobId, "job_1");
  assert.equal(mutations[1]?.args.jobId, "job_2");
});
