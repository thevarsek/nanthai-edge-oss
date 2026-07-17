import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import {
  applyAiSlideEditRef,
  beginGenerationRef,
  completeGenerationRef,
  getProjectAndSlideInternalRef,
  getProjectInternalRef,
  markFailedRef,
} from "../presentations/action_refs";
import { applyAiEditHandler } from "../presentations/action_edit_handler";
import { generateProjectHandler } from "../presentations/action_generate_handler";
import { createPresentationActionDepsForTest } from "../presentations/action_shared";

const names = {
  project: getFunctionName(getProjectInternalRef),
  projectSlide: getFunctionName(getProjectAndSlideInternalRef),
  pro: getFunctionName(internal.preferences.queries.checkProStatus),
  preferences: getFunctionName(internal.chat.queries.getUserPreferences),
  beginGeneration: getFunctionName(beginGenerationRef),
  completeGeneration: getFunctionName(completeGenerationRef),
  applyEdit: getFunctionName(applyAiSlideEditRef),
  markFailed: getFunctionName(markFailedRef),
};

function slideHtml(text: string): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden"><h1 data-element-id="headline" style="position:absolute;left:80px;top:80px;width:720px;height:100px">${text}</h1></section>`;
}

function project(status: "planned" | "ready") {
  return {
    _id: "project_1",
    _creationTime: 1,
    userId: "user_1",
    title: "Repairable",
    status,
    sourceKind: "scratch",
    prompt: "Explain a repairable workflow",
    direction: "minimal",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 2,
    plan: status === "planned" ? [
      { id: "slide_01", title: "Open", purpose: "Open", layout: "hero", imageIntent: "" },
    ] : undefined,
    createdAt: 1,
    updatedAt: 1,
  } as any;
}

function slide() {
  return {
    _id: "slide_row_1",
    _creationTime: 1,
    userId: "user_1",
    projectId: "project_1",
    slideId: "slide_01",
    position: 0,
    title: "Before",
    html: slideHtml("Before"),
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  } as any;
}

function ctx(projectValue: any, slideValue?: any) {
  return {
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.project) return projectValue;
      if (name === names.projectSlide) return { project: projectValue, slide: slideValue };
      if (name === names.pro) return true;
      if (name === names.preferences) return { defaultModelId: "anthropic/claude-sonnet-4" };
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, any>) => {
      const name = getFunctionName(ref as any);
      if (name === names.beginGeneration) return { projectId: "project_1", projectRevision: 3 };
      if (name === names.completeGeneration) {
        return { projectId: "project_1", projectRevision: 4, slideCount: args.slides.length };
      }
      if (name === names.applyEdit) {
        return { projectId: "project_1", projectRevision: 3, slideId: "slide_01", slideRevision: 1 };
      }
      if (name === names.markFailed) return true;
      throw new Error(`Unexpected mutation ${name}`);
    },
  } as any;
}

function result(content: string) {
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

function code(error: unknown): string | undefined {
  return error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

const auth = {
  requireAuth: async () => ({ userId: "user_1" }),
  getRequiredUserOpenRouterApiKey: async () => "test-key",
};

test("generation makes one bounded repair attempt", async () => {
  const responses = [
    result("not json"),
    result(JSON.stringify({
      schemaVersion: 1,
      slides: [{ id: "slide_01", title: "Open", html: slideHtml("Repaired") }],
    })),
  ];
  let calls = 0;
  const deps = createPresentationActionDepsForTest({
    ...auth,
    callOpenRouterNonStreaming: async () => responses[calls++] ?? result("unexpected"),
  });
  const generated = await generateProjectHandler(
    ctx(project("planned")),
    { projectId: "project_1" as any },
    deps,
  );
  assert.equal(generated.slideCount, 1);
  assert.equal(calls, 2);
});

test("edit repair stops after the second invalid patch", async () => {
  let calls = 0;
  const deps = createPresentationActionDepsForTest({
    ...auth,
    callOpenRouterNonStreaming: async () => {
      calls += 1;
      return result("still not json");
    },
  });
  await assert.rejects(
    () => applyAiEditHandler(
      ctx(project("ready"), slide()),
      {
        projectId: "project_1" as any,
        slideId: "slide_01",
        instruction: "Make it clearer",
        expectedRevision: 0,
      },
      deps,
    ),
    (error: unknown) => code(error) === "MODEL_RESPONSE_INVALID",
  );
  assert.equal(calls, 2);
});
