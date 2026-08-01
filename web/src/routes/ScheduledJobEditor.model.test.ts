import { expect, test } from "vitest";

import { APP_DEFAULT_MODEL_ID } from "../lib/modelDefaults";
import {
  SCHEDULED_JOB_DEFAULT_MODEL,
  buildIntegrationOverrides,
  buildIntegrations,
  buildStepsPayload,
  createDraftStep,
  hasScheduledJobGoogleIntegrations,
  integrationsFromOverrides,
  jobToSteps,
  scheduledJobModelSupportsGoogleIntegrations,
  shortModelName,
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

test("scheduled job payload preserves Remote MCP integrations in both contract fields", () => {
  const step = {
    ...createDraftStep(),
    prompt: "Search Cloudflare docs",
    remoteMcpIntegrationIds: ["mcp:cloudflare-docs"],
  };

  const payload = buildStepsPayload([step]);

  expect(payload[0]?.enabledIntegrations).toEqual(["mcp:cloudflare-docs"]);
  expect(payload[0]?.turnIntegrationOverrides).toEqual(expect.arrayContaining([
    { integrationId: "mcp:cloudflare-docs", enabled: true },
  ]));
  expect(jobToSteps({ steps: [payload[0] as Record<string, unknown>] })[0]?.remoteMcpIntegrationIds)
    .toEqual(["mcp:cloudflare-docs"]);
});

test("scheduled job payload explicitly disables unchecked known Remote MCP integrations", () => {
  const step = { ...createDraftStep(), prompt: "Run digest" };
  const payload = buildStepsPayload([step], new Set(["mcp:cloudflare-docs"]));

  expect(payload[0]?.turnIntegrationOverrides).toEqual(expect.arrayContaining([
    { integrationId: "mcp:cloudflare-docs", enabled: false },
  ]));
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

test("scheduled job integration helpers preserve every supported integration flag", () => {
  const step = {
    ...createDraftStep(),
    gmailEnabled: true,
    driveEnabled: true,
    calendarEnabled: true,
    outlookEnabled: true,
    onedriveEnabled: true,
    msCalendarEnabled: true,
    appleCalendarEnabled: true,
    notionEnabled: true,
    clozeEnabled: true,
    slackEnabled: true,
  };

  expect(buildIntegrations(step)).toEqual([
    "gmail",
    "drive",
    "calendar",
    "outlook",
    "onedrive",
    "ms_calendar",
    "apple_calendar",
    "notion",
    "cloze",
    "slack",
  ]);
  expect(buildIntegrationOverrides(step).filter((entry) => entry.enabled)).toHaveLength(10);
  expect(hasScheduledJobGoogleIntegrations(createDraftStep())).toBe(false);
});

test("scheduled job payload trims titles, clamps search complexity, and includes reasoning only when enabled", () => {
  const [webStep, researchStep] = [
    {
      ...createDraftStep(),
      title: "  Morning brief  ",
      prompt: "  Run brief  ",
      selectedPersonaId: "persona_1",
      searchMode: "web" as const,
      searchComplexity: 99,
      includeReasoning: true,
      reasoningEffort: "high",
    },
    {
      ...createDraftStep(),
      prompt: "Research",
      searchMode: "research" as const,
      searchComplexity: 0,
    },
  ];

  expect(buildStepsPayload([webStep, researchStep])).toEqual([
    expect.objectContaining({
      title: "Morning brief",
      prompt: "Run brief",
      personaId: "persona_1",
      searchMode: "web",
      webSearchEnabled: true,
      searchComplexity: 3,
      includeReasoning: true,
      reasoningEffort: "high",
    }),
    expect.objectContaining({
      prompt: "Research",
      searchMode: "research",
      webSearchEnabled: true,
      searchComplexity: 1,
      includeReasoning: false,
    }),
  ]);
});

test("scheduled job hydration supports legacy single-step fields and fallback model names", () => {
  const steps = jobToSteps({
    prompt: "Legacy digest",
    webSearchEnabled: true,
    searchComplexity: 2.6,
    includeReasoning: true,
    reasoningEffort: "low",
    enabledIntegrations: ["outlook", "onedrive", "ms_calendar", "apple_calendar", "notion", "cloze"],
  });

  expect(steps[0]).toMatchObject({
    prompt: "Legacy digest",
    searchMode: "basic",
    searchComplexity: 3,
    includeReasoning: true,
    reasoningEffort: "low",
    outlookEnabled: true,
    onedriveEnabled: true,
    msCalendarEnabled: true,
    appleCalendarEnabled: true,
    notionEnabled: true,
    clozeEnabled: true,
  });
  expect(shortModelName("openai/gpt-5.2")).toBe("gpt-5.2");
  expect(shortModelName("custom-model")).toBe("custom-model");
});
