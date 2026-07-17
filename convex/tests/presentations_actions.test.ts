import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { applyAiSlideEditRef, beginGenerationRef, beginPlanningRef, completeGenerationRef, completePlanningRef, getProjectAndSlideInternalRef, getProjectInternalRef, markFailedRef } from "../presentations/action_refs";
import { applyAiEditHandler } from "../presentations/action_edit_handler";
import { generateProjectHandler } from "../presentations/action_generate_handler";
import { planProjectHandler } from "../presentations/action_plan_handler";
import { createPresentationActionDepsForTest } from "../presentations/action_shared";
import { DeferredPresentationRepair } from "../presentations/deferred_repair";
import type { ChatRequestParameters, RetryConfig } from "../lib/openrouter";
import { MODEL_IDS } from "../lib/model_constants";
import {
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
  PRESENTATION_MODEL_TIMEOUT_MS,
} from "../presentations/limits";

const refs = {
  project: getFunctionName(getProjectInternalRef),
  projectSlide: getFunctionName(getProjectAndSlideInternalRef),
  pro: getFunctionName(internal.preferences.queries.checkProStatus),
  preferences: getFunctionName(internal.chat.queries.getUserPreferences),
  beginPlanning: getFunctionName(beginPlanningRef),
  completePlanning: getFunctionName(completePlanningRef),
  beginGeneration: getFunctionName(beginGenerationRef),
  completeGeneration: getFunctionName(completeGenerationRef),
  markFailed: getFunctionName(markFailedRef),
  applyEdit: getFunctionName(applyAiSlideEditRef),
};

function html(text: string): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden"><h1 data-element-id="headline" style="position:absolute;left:80px;top:80px;width:720px;height:100px;font-size:64px">${text}</h1></section>`;
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    _id: "project_1",
    _creationTime: 1,
    userId: "user_1",
    title: "Work changed",
    status: "draft",
    sourceKind: "scratch",
    prompt: "Explain the future of work",
    direction: "editorial",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as any;
}

function slide(overrides: Record<string, unknown> = {}) {
  return {
    _id: "slide_row_1",
    _creationTime: 1,
    userId: "user_1",
    projectId: "project_1",
    slideId: "slide_01",
    position: 0,
    title: "Opening",
    html: html("Before"),
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as any;
}

function openRouterResult(content: string) {
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

function buildCtx(options: {
  project?: ReturnType<typeof project> | null;
  slide?: ReturnType<typeof slide> | null;
  isPro?: boolean;
  preferences?: Record<string, unknown> | null;
  mutations?: (name: string, args: Record<string, any>) => Promise<any>;
}) {
  return {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === refs.project) return options.project ?? null;
      if (name === refs.projectSlide) {
        return options.project && options.slide
          ? { project: options.project, slide: options.slide }
          : null;
      }
      if (name === refs.pro) return options.isPro ?? true;
      if (name === refs.preferences) {
        return options.preferences ?? { defaultModelId: "anthropic/claude-sonnet-4" };
      }
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, any>) => {
      const name = getFunctionName(ref as any);
      if (options.mutations) return await options.mutations(name, args);
      if (name === refs.beginPlanning || name === refs.beginGeneration) {
        return { projectId: "project_1", projectRevision: 1 };
      }
      if (name === refs.completePlanning || name === refs.completeGeneration) {
        return {
          projectId: "project_1",
          projectRevision: 2,
          ...(name === refs.completeGeneration ? { slideCount: 2 } : {}),
        };
      }
      if (name === refs.markFailed) return true;
      if (name === refs.applyEdit) {
        return { projectId: "project_1", projectRevision: 4, slideId: "slide_01", slideRevision: 1 };
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
  } as any;
}

const authAndKey = {
  requireAuth: async () => ({ userId: "user_1" }),
  getRequiredUserOpenRouterApiKey: async () => "fake-test-key",
};

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError ? (error.data as any)?.code : undefined;
}

test("planProject uses stored BYOK and user default model, then persists the outline", async () => {
  const calls: Array<{
    key: string;
    model: string;
    params: ChatRequestParameters;
    retryConfig: RetryConfig;
  }> = [];
  let completedPlan: unknown;
  const deps = createPresentationActionDepsForTest({
    ...authAndKey,
    callOpenRouterNonStreaming: async (key, model, _messages, params, retryConfig) => {
      calls.push({ key, model, params, retryConfig: retryConfig ?? {} });
      return openRouterResult(JSON.stringify({
        schemaVersion: 1,
        title: "The workplace, rewritten",
        slides: [
          { id: "slide_01", title: "Old rules", purpose: "Set tension", layout: "editorial hero", imageIntent: "" },
          { id: "slide_02", title: "New rules", purpose: "Resolve", layout: "annotated split", imageIntent: "" },
        ],
      }));
    },
  });
  const ctx = buildCtx({
    project: project(),
    mutations: async (name, args) => {
      if (name === refs.beginPlanning) return { projectId: "project_1", projectRevision: 1 };
      if (name === refs.completePlanning) {
        completedPlan = args.plan;
        return { projectId: "project_1", projectRevision: 2 };
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
  });
  const result = await planProjectHandler(ctx, {
    projectId: "project_1" as any,
    prompt: "Show how work is changing",
    direction: "editorial",
    imageMode: "none",
  }, deps);

  assert.equal(result.status, "planned");
  assert.equal(result.plan.length, 2);
  assert.equal((completedPlan as any[]).length, 2);
  assert.deepEqual(calls[0], {
    key: "fake-test-key",
    model: "anthropic/claude-sonnet-4",
    params: { temperature: 0.35, includeReasoning: false },
    retryConfig: {
      fallbackModel: MODEL_IDS.appDefault,
      requestTimeoutMs: PRESENTATION_MODEL_TIMEOUT_MS,
      totalTimeoutMs: PRESENTATION_MODEL_TIMEOUT_MS,
    },
  });
});

test("AI presentation actions enforce Pro before reading the stored key", async () => {
  let keyRead = false;
  const deps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
    getRequiredUserOpenRouterApiKey: async () => {
      keyRead = true;
      return "should-not-be-read";
    },
  });
  await assert.rejects(
    () => planProjectHandler(buildCtx({ project: project(), isPro: false }), {
      projectId: "project_1" as any,
      prompt: "A valid brief",
      direction: "minimal",
      imageMode: "none",
    }, deps),
    (error: unknown) => errorCode(error) === "PRO_REQUIRED",
  );
  assert.equal(keyRead, false);
});

test("planProject surfaces missing key and marks malformed model output failed", async () => {
  const missingKeyDeps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
    getRequiredUserOpenRouterApiKey: async () => {
      throw new ConvexError({ code: "MISSING_API_KEY", message: "Reconnect OpenRouter." });
    },
  });
  await assert.rejects(
    () => planProjectHandler(buildCtx({ project: project() }), {
      projectId: "project_1" as any, prompt: "A valid brief",
      direction: "minimal", imageMode: "none",
    }, missingKeyDeps),
    (error: unknown) => errorCode(error) === "MISSING_API_KEY",
  );

  let failed = false;
  const malformedDeps = createPresentationActionDepsForTest({
    ...authAndKey,
    callOpenRouterNonStreaming: async () => openRouterResult("```json\n{not valid}\n```"),
  });
  await assert.rejects(
    () => planProjectHandler(buildCtx({
      project: project(),
      mutations: async (name) => {
        if (name === refs.beginPlanning) return { projectId: "project_1", projectRevision: 1 };
        if (name === refs.markFailed) { failed = true; return true; }
        throw new Error(`Unexpected mutation ${name}`);
      },
    }), {
      projectId: "project_1" as any, prompt: "A valid brief",
      direction: "minimal", imageMode: "none",
    }, malformedDeps),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
  assert.equal(failed, true);
});

test("durable creation hands invalid outputs to fresh repair actions", async () => {
  let modelCalls = 0;
  let markedFailed = false;
  const deps = createPresentationActionDepsForTest({
    ...authAndKey,
    callOpenRouterNonStreaming: async () => {
      modelCalls += 1;
      return openRouterResult("{not valid}");
    },
  });
  const ctx = buildCtx({
    project: project(),
    mutations: async (name) => {
      if (name === refs.beginPlanning) {
        return { projectId: "project_1", projectRevision: 1 };
      }
      if (name === refs.markFailed) {
        markedFailed = true;
        return true;
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
  });

  await assert.rejects(
    () => planProjectHandler(ctx, {
      projectId: "project_1" as any,
      prompt: "A valid brief",
      direction: "minimal",
      imageMode: "none",
    }, deps, {
      deferRepair: true,
      modelTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    }),
    (error: unknown) => error instanceof DeferredPresentationRepair &&
      error.effectiveModelId === "anthropic/claude-sonnet-4",
  );

  assert.equal(modelCalls, 1);
  assert.equal(markedFailed, false);

  const plan = [
    { id: "slide_01", title: "Open", purpose: "Open", layout: "hero", imageIntent: "" },
  ];
  modelCalls = 0;
  await assert.rejects(
    () => generateProjectHandler(buildCtx({
      project: project({ status: "planned", revision: 2, plan }),
      mutations: async (name) => {
        if (name === refs.beginGeneration) {
          return { projectId: "project_1", projectRevision: 3 };
        }
        if (name === refs.markFailed) {
          markedFailed = true;
          return true;
        }
        throw new Error(`Unexpected mutation ${name}`);
      },
    }), { projectId: "project_1" as any }, deps, {
      deferRepair: true,
      modelTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    }),
    (error: unknown) => error instanceof DeferredPresentationRepair &&
      error.effectiveModelId === "anthropic/claude-sonnet-4",
  );

  assert.equal(modelCalls, 1);
  assert.equal(markedFailed, false);
});

test("generateProject and applyAiEdit persist only validated scoped output", async () => {
  const plan = [
    { id: "slide_01", title: "Open", purpose: "Open", layout: "hero", imageIntent: "" },
    { id: "slide_02", title: "Close", purpose: "Close", layout: "statement", imageIntent: "" },
  ];
  let generatedSlides: any[] = [];
  const generationParams: ChatRequestParameters[] = [];
  const generationDeps = createPresentationActionDepsForTest({
    ...authAndKey,
    callOpenRouterNonStreaming: async (_key, _model, _messages, params) => {
      generationParams.push(params);
      return openRouterResult(JSON.stringify({
        schemaVersion: 1,
        slides: [
          { id: "slide_01", title: "Open", html: html("Opening") },
          { id: "slide_02", title: "Close", html: html("Closing") },
        ],
      }));
    },
  });
  const generated = await generateProjectHandler(buildCtx({
    project: project({ status: "planned", revision: 2, plan }),
    mutations: async (name, args) => {
      if (name === refs.beginGeneration) return { projectId: "project_1", projectRevision: 3 };
      if (name === refs.completeGeneration) {
        generatedSlides = args.slides;
        return { projectId: "project_1", projectRevision: 4, slideCount: args.slides.length };
      }
      throw new Error(`Unexpected mutation ${name}`);
    },
  }), { projectId: "project_1" as any }, generationDeps);
  assert.equal(generated.slideCount, 2);
  assert.equal(generatedSlides[0]?.id, "slide_01");
  assert.deepEqual(generationParams, [
    { temperature: 0.65, includeReasoning: false },
  ]);

  const editParams: ChatRequestParameters[] = [];
  const editDeps = createPresentationActionDepsForTest({
    ...authAndKey,
    callOpenRouterNonStreaming: async (_key, _model, _messages, params) => {
      editParams.push(params);
      return openRouterResult(JSON.stringify({
        schemaVersion: 1,
        slideId: "slide_01",
        title: "After",
        operations: [{ op: "replace_text", elementId: "headline", text: "After" }],
      }));
    },
  });
  const edited = await applyAiEditHandler(buildCtx({
    project: project({ status: "ready", revision: 3 }),
    slide: slide({ notes: "Keep this note" }),
  }), {
    projectId: "project_1" as any,
    slideId: "slide_01",
    instruction: "Change the headline to After",
    expectedRevision: 0,
  }, editDeps);
  assert.equal(edited.slideRevision, 1);
  assert.equal(edited.title, "After");
  assert.equal(edited.html, html("After"));
  assert.equal(edited.notes, "Keep this note");
  assert.deepEqual(editParams, [
    { temperature: 0.25, includeReasoning: false },
  ]);
});
