import { expect, test } from "vitest";

import { APP_DEFAULT_MODEL_ID } from "../lib/modelDefaults";
import {
  SCHEDULED_JOB_DEFAULT_MODEL,
  buildStepsPayload,
  createDraftStep,
  hasScheduledJobGoogleIntegrations,
  integrationsFromOverrides,
  jobToSteps,
  scheduledJobModelSupportsGoogleIntegrations,
} from "./ScheduledJobEditor.model";

test("scheduled job draft defaults match app model default", () => {
  const step = createDraftStep();

  expect(SCHEDULED_JOB_DEFAULT_MODEL).toBe(APP_DEFAULT_MODEL_ID);
  expect(step.modelId).toBe(APP_DEFAULT_MODEL_ID);
});

test("scheduled job payload preserves knowledge base file ids", () => {
  const step = {
    ...createDraftStep(),
    prompt: "Summarize KB notes",
    knowledgeBaseFileIds: ["kb_1", "kb_2"],
  };

  const payload = buildStepsPayload([step]);

  expect(payload[0]?.knowledgeBaseFileIds).toEqual(["kb_1", "kb_2"]);
});

test("scheduled job payload explicitly clears knowledge base file ids", () => {
  const step = {
    ...createDraftStep(),
    prompt: "Summarize KB notes",
    knowledgeBaseFileIds: [],
  };

  const payload = buildStepsPayload([step]);

  expect(payload[0]?.knowledgeBaseFileIds).toEqual([]);
});

test("scheduled job payload preserves explicit disabled integrations and reasoning", () => {
  const step = {
    ...createDraftStep(),
    prompt: "Run unattended digest",
    gmailEnabled: true,
    driveEnabled: false,
    includeReasoning: false,
    reasoningEffort: "high",
  };

  const payload = buildStepsPayload([step]);

  expect(payload[0]?.enabledIntegrations).toEqual(["gmail"]);
  expect(payload[0]?.turnIntegrationOverrides).toEqual(
    expect.arrayContaining([
      { integrationId: "gmail", enabled: true },
      { integrationId: "drive", enabled: false },
      { integrationId: "slack", enabled: false },
    ]),
  );
  expect(payload[0]?.includeReasoning).toBe(false);
  expect(payload[0]).not.toHaveProperty("reasoningEffort");
});

test("scheduled job hydration prefers structured integration overrides", () => {
  const steps = jobToSteps({
    steps: [{
      prompt: "Run digest",
      modelId: "openai/gpt-5",
      enabledIntegrations: [],
      turnIntegrationOverrides: [
        { integrationId: "gmail", enabled: true },
        { integrationId: "drive", enabled: false },
        { integrationId: "slack", enabled: true },
      ],
    }],
  });

  expect(steps[0]?.gmailEnabled).toBe(true);
  expect(steps[0]?.driveEnabled).toBe(false);
  expect(steps[0]?.slackEnabled).toBe(true);
  expect(buildStepsPayload(steps)[0]?.turnIntegrationOverrides).toEqual(
    expect.arrayContaining([
      { integrationId: "gmail", enabled: true },
      { integrationId: "drive", enabled: false },
      { integrationId: "slack", enabled: true },
    ]),
  );
});

test("scheduled job integration hydration falls back to legacy enabled integrations", () => {
  expect(integrationsFromOverrides(["drive", "calendar"], undefined)).toEqual(["drive", "calendar"]);
});

test("scheduled job Google integrations include Gmail, Drive, and Calendar", () => {
  expect(hasScheduledJobGoogleIntegrations({ ...createDraftStep(), gmailEnabled: true })).toBe(true);
  expect(hasScheduledJobGoogleIntegrations({ ...createDraftStep(), driveEnabled: true })).toBe(true);
  expect(hasScheduledJobGoogleIntegrations({ ...createDraftStep(), calendarEnabled: true })).toBe(true);
});

test("scheduled job Google integrations require allowed ZDR model", () => {
  expect(scheduledJobModelSupportsGoogleIntegrations("openai/gpt-5", {
    modelId: "openai/gpt-5",
    provider: "openai",
    hasZdrEndpoint: true,
  })).toBe(true);
  expect(scheduledJobModelSupportsGoogleIntegrations("meta-llama/llama-4", {
    modelId: "meta-llama/llama-4",
    provider: "meta-llama",
    hasZdrEndpoint: true,
  })).toBe(false);
  expect(scheduledJobModelSupportsGoogleIntegrations("google/gemini-2.5-pro", {
    modelId: "google/gemini-2.5-pro",
    provider: "google",
    hasZdrEndpoint: false,
  })).toBe(false);
});
