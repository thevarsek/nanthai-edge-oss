import { expect, test } from "vitest";

import { APP_DEFAULT_MODEL_ID } from "../lib/modelDefaults";
import {
  SCHEDULED_JOB_DEFAULT_MODEL,
  buildStepsPayload,
  createDraftStep,
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
