import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { internal } from "../_generated/api";
import { MODEL_IDS } from "../lib/model_constants";
import type { ChatRequestParameters } from "../lib/openrouter";
import {
  beginPlanningRef,
  completePlanningRef,
  getProjectInternalRef,
} from "../presentations/action_refs";
import { planProjectHandler } from "../presentations/action_plan_handler";
import { createPresentationActionDepsForTest } from "../presentations/action_shared";

test("presentation AI preserves a stricter turn-level ZDR requirement", async () => {
  let capturedModel = "";
  let capturedParams: ChatRequestParameters | undefined;
  const deps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
    getRequiredUserOpenRouterApiKey: async () => "fake-test-key",
    callOpenRouterNonStreaming: async (_key, model, _messages, params) => {
      capturedModel = model;
      capturedParams = params;
      return {
        content: JSON.stringify({
          schemaVersion: 1,
          title: "Protected deck",
          slides: [
            { id: "slide_01", title: "Open", purpose: "Open", layout: "hero", imageIntent: "" },
            { id: "slide_02", title: "Close", purpose: "Close", layout: "statement", imageIntent: "" },
          ],
        }),
        usage: null,
        finishReason: "stop",
        audioBase64: "",
        audioTranscript: "",
        generationId: null,
        annotations: [],
      };
    },
  });
  const names = {
    project: getFunctionName(getProjectInternalRef),
    pro: getFunctionName(internal.preferences.queries.checkProStatus),
    preferences: getFunctionName(internal.chat.queries.getUserPreferences),
    begin: getFunctionName(beginPlanningRef),
    complete: getFunctionName(completePlanningRef),
  };
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === names.project) {
        return {
          _id: "project_1",
          userId: "user_1",
          title: "Deck",
          status: "draft",
          sourceKind: "scratch",
          prompt: "Brief",
          direction: "minimal",
          imageMode: "none",
          aspectRatio: "16:9",
          revision: 0,
          createdAt: 1,
          updatedAt: 1,
        };
      }
      if (name === names.pro) return true;
      if (name === names.preferences) {
        return { defaultModelId: "provider/non-zdr-model", zdrEnabled: false };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === names.begin) return { projectId: "project_1", projectRevision: 1 };
      if (name === names.complete) return { projectId: "project_1", projectRevision: 2 };
      throw new Error(`Unexpected mutation ${name}`);
    },
  } as never;

  await planProjectHandler(ctx, {
    projectId: "project_1" as never,
    prompt: "A protected brief",
    direction: "minimal",
    imageMode: "none",
    requireZdrOverride: true,
  }, deps);

  assert.equal(capturedModel, MODEL_IDS.appDefault);
  assert.equal(capturedParams?.provider?.zdr, true);
});
