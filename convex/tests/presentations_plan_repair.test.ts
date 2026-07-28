import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import {
  beginPlanningRef,
  completePlanningRef,
  getProjectInternalRef,
} from "../presentations/action_refs";
import { planProjectHandler } from "../presentations/action_plan_handler";
import { createPresentationActionDepsForTest } from "../presentations/action_shared";
import {
  MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
} from "../presentations/limits";
import {
  parsePresentationPlan,
  parseRepairedPresentationPlan,
} from "../presentations/model_parsing";
import {
  buildPlanningMessages,
  buildPlanningRepairMessages,
} from "../presentations/prompts";

const names = {
  project: getFunctionName(getProjectInternalRef),
  pro: getFunctionName(internal.preferences.queries.checkProStatus),
  preferences: getFunctionName(internal.chat.queries.getUserPreferences),
  beginPlanning: getFunctionName(beginPlanningRef),
  completePlanning: getFunctionName(completePlanningRef),
};

const overlongStrategy =
  "Anchor the headline in a quiet upper-left field. " +
  "Use the remaining canvas to create a deliberate visual path. ".repeat(8);

function plan(spatialStrategy = overlongStrategy): string {
  return JSON.stringify({
    schemaVersion: 1,
    title: "Bounded planning",
    slides: [{
      id: "slide_01",
      title: "Opening",
      purpose: "Set the central tension",
      layout: "asymmetric editorial hero",
      imageIntent: "",
      spatialStrategy,
    }],
  });
}

function response(content: string) {
  return {
    content,
    usage: null,
    finishReason: "stop",
    audioBase64: "",
    audioTranscript: "",
    generationId: null,
    annotations: [],
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

test("planning repair compacts only advisory text and preserves strict structure", () => {
  assert.throws(
    () => parsePresentationPlan(plan()),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );

  const repaired = parseRepairedPresentationPlan(plan());
  const strategy = repaired.slides[0]?.spatialStrategy ?? "";
  assert.ok(strategy.length > 0);
  assert.ok(strategy.length <= MAX_PRESENTATION_PLAN_GUIDANCE_CHARS);
  assert.ok(!strategy.endsWith(" "));

  assert.throws(
    () => parseRepairedPresentationPlan(plan("short").replace("slide_01", "1-invalid")),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("planner repair prompt states the model contract in characters", () => {
  const initial = buildPlanningMessages({
    prompt: "Explain bounded planning",
    direction: "editorial",
    imageMode: "none",
  });
  const repair = buildPlanningRepairMessages({
    prompt: "Explain bounded planning",
    direction: "editorial",
    imageMode: "none",
    invalidResponse: plan(),
    validationError: "spatialStrategy exceeded its limit",
  });

  assert.match(String(initial[0]?.content), /character counts, not word counts/);
  assert.match(
    String(repair.at(-1)?.content),
    new RegExp(`spatialStrategy.*<=${MAX_PRESENTATION_PLAN_GUIDANCE_CHARS}`),
  );
  assert.match(String(repair.at(-1)?.content), /Rewrite every invalid or overlong field/);
});

test("planProject accepts bounded post-repair guidance after two invalid model drafts", async () => {
  let calls = 0;
  let persistedStrategy = "";
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === names.project) {
        return {
          _id: "project_1",
          userId: "user_1",
          title: "Bounded planning",
          status: "draft",
          sourceKind: "scratch",
          prompt: "Explain bounded planning",
          direction: "editorial",
          imageMode: "none",
          aspectRatio: "16:9",
          revision: 0,
          createdAt: 1,
          updatedAt: 1,
        };
      }
      if (name === names.pro) return true;
      if (name === names.preferences) return { defaultModelId: "openai/gpt-5.6-terra" };
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      if (name === names.beginPlanning) {
        return { projectId: "project_1", projectRevision: 1 };
      }
      if (name === names.completePlanning) {
        const savedPlan = args.plan as Array<{ spatialStrategy?: string }>;
        persistedStrategy = savedPlan[0]?.spatialStrategy ?? "";
        return { projectId: "project_1", projectRevision: 2 };
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
  };
  const deps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
    getRequiredUserOpenRouterApiKey: async () => "test-key",
    callOpenRouterNonStreaming: async () => {
      calls += 1;
      return response(plan());
    },
  });

  const result = await planProjectHandler(ctx as never, {
    projectId: "project_1" as never,
    prompt: "Explain bounded planning",
    direction: "editorial",
    imageMode: "none",
  }, deps);

  assert.equal(result.status, "planned");
  assert.equal(calls, 2);
  assert.ok(persistedStrategy.length <= MAX_PRESENTATION_PLAN_GUIDANCE_CHARS);
});
