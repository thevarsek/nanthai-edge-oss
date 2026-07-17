import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import {
  analyzePresentationCandidates,
  consolidationPreservesContent,
} from "../presentations/curation_analysis";
import {
  completePresentationCuratorTaskHandler,
} from "../presentations/generation_curator_mutation_handlers";
import { buildPresentationStudioBatches } from "../presentations/generation_fanout";
import {
  runPresentationCuratorRef,
  runPresentationFinalizerRef,
} from "../presentations/generation_fanout_refs";
import { completePresentationStudioBatchHandler } from "../presentations/generation_studio_mutation_handlers";
import { buildResolvedPresentationBrief } from "../tools/presentation_brief";

type Row = Record<string, unknown> & { _id: string };

function slideHtml(elementId: string, text: string): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden"><h1 data-element-id="${elementId}" style="position:absolute;left:80px;top:80px;width:900px;height:120px;font-size:42px;line-height:52px">${text}</h1></section>`;
}

function plan(ids: string[]) {
  return ids.map((id) => ({
    id,
    title: id.toUpperCase(),
    purpose: `Purpose ${id}`,
    layout: `Layout ${id}`,
    imageIntent: "",
  }));
}

function mutationState(initial: Record<string, Row[]>) {
  const tables = new Map(Object.entries(initial));
  const scheduled: Array<{ name: string; args: Record<string, unknown> }> = [];
  let nextId = 1;
  const allRows = () => [...tables.values()].flat();
  const ctx = {
    db: {
      get: async (id: string) => allRows().find((row) => row._id === id) ?? null,
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${nextId++}`;
        tables.set(table, [...(tables.get(table) ?? []), { _id: id, ...value }]);
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = allRows().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async (id: string) => {
        for (const [table, rows] of tables) {
          tables.set(table, rows.filter((row) => row._id !== id));
        }
      },
      query: (table: string) => {
        let rows = tables.get(table) ?? [];
        const chain = {
          withIndex: (_name: string, apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            apply(builder);
            rows = rows.filter((row) => filters.every(([field, value]) => row[field] === value));
            return chain;
          },
          collect: async () => [...rows].sort((left, right) =>
            Number(left.position ?? left.batchIndex ?? 0) - Number(right.position ?? right.batchIndex ?? 0)
          ),
          first: async () => rows[0] ?? null,
        };
        return chain;
      },
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ name: getFunctionName(ref as never), args });
        return `scheduled_${scheduled.length}`;
      },
    },
  };
  return { ctx, tables, scheduled };
}

test("studio fan-out adapts from one to four workers without losing slide order", () => {
  assert.deepEqual(buildPresentationStudioBatches(plan(["a", "b", "c", "d", "e"])), [
    { batchIndex: 0, slideIds: ["a", "b", "c", "d", "e"] },
  ]);
  assert.deepEqual(buildPresentationStudioBatches(plan(["a", "b", "c", "d", "e", "f"])), [
    { batchIndex: 0, slideIds: ["a", "b", "c"] },
    { batchIndex: 1, slideIds: ["d", "e", "f"] },
  ]);
  const fifteen = buildPresentationStudioBatches(plan(
    Array.from({ length: 15 }, (_, index) => `s${index + 1}`),
  ));
  assert.equal(fifteen.length, 3);
  assert.deepEqual(fifteen.flatMap((batch) => batch.slideIds),
    Array.from({ length: 15 }, (_, index) => `s${index + 1}`));
  const twentyIds = Array.from({ length: 20 }, (_, index) => `s${index + 1}`);
  const twenty = buildPresentationStudioBatches(plan(twentyIds));
  assert.equal(twenty.length, 4);
  assert.deepEqual(twenty.map((batch) => batch.slideIds.length), [5, 5, 5, 5]);
  assert.deepEqual(twenty.flatMap((batch) => batch.slideIds), twentyIds);
});

test("the exact studio slide-ID barrier queues the curator once", async () => {
  const state = mutationState({
    presentationProjects: [{
      _id: "project_1", userId: "user_1", status: "generating", revision: 3,
      plan: plan(["a", "b"]), imageMode: "none", assetStorageIds: [],
    }],
    presentationGenerationRuns: [{
      _id: "run_1", userId: "user_1", projectId: "project_1", projectRevision: 3,
      expectedSlideIds: ["a", "b"], completedSlideIds: [], deletedSlideIds: [],
      status: "generating",
    }],
    presentationGenerationBatches: [
      { _id: "batch_1", runId: "run_1", status: "running", slideIds: ["a"], effectiveModelIds: [] },
      { _id: "batch_2", runId: "run_1", status: "running", slideIds: ["b"], effectiveModelIds: [] },
    ],
    presentationSlideCandidates: [],
  });
  const ctx = state.ctx as unknown as Parameters<typeof completePresentationStudioBatchHandler>[0];
  const first = await completePresentationStudioBatchHandler(ctx, {
    runId: "run_1" as never, batchId: "batch_1" as never,
    slides: [{ id: "a", title: "A", html: slideHtml("a-title", "Alpha") }],
    effectiveModelId: "selected/model",
  });
  assert.equal(first.curatorQueued, false);
  const second = await completePresentationStudioBatchHandler(ctx, {
    runId: "run_1" as never, batchId: "batch_2" as never,
    slides: [{ id: "b", title: "B", html: slideHtml("b-title", "Beta") }],
    effectiveModelId: "fallback/model",
  });
  assert.equal(second.curatorQueued, true);
  const duplicate = await completePresentationStudioBatchHandler(ctx, {
    runId: "run_1" as never, batchId: "batch_2" as never,
    slides: [{ id: "b", title: "B", html: slideHtml("b-title", "Beta") }],
    effectiveModelId: "fallback/model",
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(state.scheduled.filter((entry) =>
    entry.name === getFunctionName(runPresentationCuratorRef)
  ).length, 1);
});

test("studio completion can release structurally safe slides with unresolved layout issues", async () => {
  const state = mutationState({
    presentationProjects: [{
      _id: "project_1", userId: "user_1", status: "generating", revision: 3,
      plan: plan(["a"]), imageMode: "none", assetStorageIds: [],
    }],
    presentationGenerationRuns: [{
      _id: "run_1", userId: "user_1", projectId: "project_1", projectRevision: 3,
      expectedSlideIds: ["a"], completedSlideIds: [], deletedSlideIds: [],
      status: "generating",
    }],
    presentationGenerationBatches: [{
      _id: "batch_1", runId: "run_1", status: "running", slideIds: ["a"],
      effectiveModelIds: [],
    }],
    presentationSlideCandidates: [],
  });
  const overlapping = `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">` +
    '<h1 data-element-id="title" style="position:absolute;left:80px;top:100px;width:700px;height:120px;font-size:40px;line-height:48px">The same words occupy this line</h1>' +
    '<p data-element-id="subtitle" style="position:absolute;left:80px;top:120px;width:700px;height:80px;font-size:40px;line-height:48px">More words occupy the same line</p></section>';
  const result = await completePresentationStudioBatchHandler(
    state.ctx as unknown as Parameters<typeof completePresentationStudioBatchHandler>[0],
    {
      runId: "run_1" as never,
      batchId: "batch_1" as never,
      slides: [{ id: "a", title: "A", html: overlapping }],
      effectiveModelId: "selected/model",
      allowLayoutIssues: true,
    },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.curatorQueued, true);
  assert.equal(state.tables.get("presentationSlideCandidates")?.length, 1);
});

test("curation analysis separates content consolidation from visual recomposition", () => {
  const candidates = [
    { slideId: "a", title: "Shared", html: slideHtml("a", "Shared market growth strategy metric 42 now") },
    { slideId: "b", title: "Shared", html: slideHtml("b", "Shared market growth strategy metric 42 now") },
    { slideId: "c", title: "C", html: slideHtml("c", "Operations reliability latency ownership roadmap") },
    { slideId: "d", title: "D", html: slideHtml("d", "Customer retention cohort activation expansion") },
  ];
  const tasks = analyzePresentationCandidates(candidates);
  assert.deepEqual(tasks.find((task) => task.kind === "consolidate")?.slideIds, ["a", "b"]);
  assert.deepEqual(tasks.filter((task) => task.kind === "recompose").map((task) => task.slideIds), [["d"]]);
  assert.equal(consolidationPreservesContent([candidates[0]!, candidates[1]!], candidates[0]!), true);
  assert.equal(consolidationPreservesContent([candidates[0]!, candidates[2]!], candidates[0]!), false);
  assert.equal(consolidationPreservesContent([
    { slideId: "a", title: "Overview", html: slideHtml("a", "Shared metric") },
    { slideId: "b", title: "Overview", html: slideHtml("b", "Shared metric AI") },
  ], { slideId: "a", title: "Overview", html: slideHtml("a", "Shared metric") }), false);
});

test("duplicate deletion is rejected until the survivor contains every distinct token", async () => {
  const base = {
    presentationProjects: [{
      _id: "project_1", userId: "user_1", status: "generating", revision: 5,
      plan: plan(["a", "b"]), imageMode: "none", assetStorageIds: [],
    }],
    presentationGenerationRuns: [{
      _id: "run_1", userId: "user_1", projectId: "project_1", projectRevision: 5,
      expectedSlideIds: ["a", "b"], completedSlideIds: ["a", "b"], deletedSlideIds: [],
      status: "curating",
    }],
    presentationCuratorTasks: [{
      _id: "task_1", runId: "run_1", status: "running", kind: "consolidate",
      slideIds: ["a", "b"], effectiveModelIds: [],
    }],
    presentationSlideCandidates: [
      { _id: "candidate_a", runId: "run_1", slideId: "a", position: 0, title: "A", notes: "", html: slideHtml("a", "shared market growth strategy metric 42"), revision: 0, effectiveModelId: "selected/model" },
      { _id: "candidate_b", runId: "run_1", slideId: "b", position: 1, title: "B", notes: "", html: slideHtml("b", "shared market growth strategy metric 42 gammaunique"), revision: 0, effectiveModelId: "selected/model" },
    ],
  } satisfies Record<string, Row[]>;
  const state = mutationState(base);
  const ctx = state.ctx as unknown as Parameters<typeof completePresentationCuratorTaskHandler>[0];
  await assert.rejects(() => completePresentationCuratorTaskHandler(ctx, {
    taskId: "task_1" as never, slides: [], deleteSlideIds: ["b"],
  }), /lose distinct slide content/);
  assert.equal(state.tables.get("presentationSlideCandidates")?.length, 2);

  const accepted = await completePresentationCuratorTaskHandler(ctx, {
    taskId: "task_1" as never,
    slides: [{
      id: "a", title: "A B",
      html: slideHtml("a", "shared market growth strategy metric 42 gammaunique"),
    }],
    deleteSlideIds: ["b"],
    effectiveModelId: "selected/model",
  });
  assert.equal(accepted.finalizerQueued, true);
  assert.deepEqual(state.tables.get("presentationSlideCandidates")?.map((row) => row.slideId), ["a"]);
  assert.equal(state.scheduled.filter((entry) =>
    entry.name === getFunctionName(runPresentationFinalizerRef)
  ).length, 1);
});

test("compact presentation briefs do not repeat the triggering user source", async () => {
  const triggering = "Create a technical deck about the 42 percent latency reduction.";
  const toolCtx = {
    userMessageId: "message_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async () => ({ role: "user", chatId: "chat_1", content: triggering }),
    },
  } as never;
  const brief = await buildResolvedPresentationBrief(toolCtx, {
    sourceContent: triggering,
    objective: "Secure approval",
    slideCount: 2,
    approvedOutline: [
      { title: "Decision", purpose: "Frame the choice" },
      { title: "Evidence", purpose: "Support the recommendation" },
    ],
  }, triggering, "Engineering leaders", "Technical and direct");
  assert.equal(brief.split(triggering).length - 1, 1);
  assert.doesNotMatch(brief, /Creative brief:/);
  assert.match(brief, /Requested length: 2 slides/);
  assert.match(brief, /"title":"Decision","purpose":"Frame the choice"/);

  const withEarlierSource = await buildResolvedPresentationBrief(toolCtx, {
    sourceContent: "Earlier-turn source label: Project Aurora.",
  }, "Use an asymmetric editorial rhythm", "Engineering leaders", "Technical and direct");
  assert.match(withEarlierSource, /Project Aurora/);
  assert.match(withEarlierSource, /Creative brief: Use an asymmetric editorial rhythm/);
});
