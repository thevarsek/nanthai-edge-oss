import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeImageCandidates,
  detectStandaloneBase64Image,
  extractInlineImagePayloads,
  hydrateAttachmentsForRequest,
  persistGeneratedImageUrlsWithTracking,
} from "../chat/action_image_helpers";
import {
  extractGeneratedCharts,
  extractGeneratedFiles,
} from "../chat/generated_file_helpers";
import {
  createScheduledJob,
  deleteScheduledJob,
  listScheduledJobs,
} from "../tools/scheduled_jobs";
import { updateScheduledJob } from "../tools/scheduled_jobs_update";

test("image helper edge cases cover MIME detection, dedupe, storage, and hydration fallbacks", async () => {
  const png = "iVBORw0KGgo" + "a".repeat(8200);
  const jpeg = "/9j/" + "b".repeat(8200);
  const gif = "R0lGOD" + "c".repeat(8200);
  const webp = "UklGR" + "d".repeat(8200);

  assert.match(detectStandaloneBase64Image(png) ?? "", /^data:image\/png/);
  assert.match(detectStandaloneBase64Image(jpeg) ?? "", /^data:image\/jpeg/);
  assert.match(detectStandaloneBase64Image(gif) ?? "", /^data:image\/gif/);
  assert.match(detectStandaloneBase64Image(webp) ?? "", /^data:image\/webp/);
  assert.equal(detectStandaloneBase64Image("short"), undefined);

  const inline = extractInlineImagePayloads(`before ![](data:image/png;base64,${"a".repeat(80)}) after`);
  assert.equal(inline.imagePayloads.length, 1);
  assert.equal(extractInlineImagePayloads("no image").text, "no image");
  assert.deepEqual(dedupeImageCandidates([" ", "https://x/a.png", "https://x/a.png", "a".repeat(80)]).length, 2);

  const storedBlobs: Blob[] = [];
  const ctx = {
    storage: {
      store: async (blob: Blob) => {
        storedBlobs.push(blob);
        return "storage_1";
      },
      getUrl: async (id: string) => id === "missing_url" ? null : `https://files/${id}`,
      get: async (id: string) => id === "missing_blob" ? null : new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
    },
  } as any;

  const persisted = await persistGeneratedImageUrlsWithTracking(ctx, [
    "https://already.example/image.png",
    `data:image/png;base64,${Buffer.from("img").toString("base64")}`,
    "not base64",
    "",
  ]);
  assert.deepEqual(persisted.urls, ["https://already.example/image.png", "https://files/storage_1", "not base64"]);
  assert.equal(storedBlobs.length, 1);

  const hydrated = await hydrateAttachmentsForRequest(ctx, [
    { _id: "msg_1", role: "user", content: "plain" },
    {
      _id: "msg_2",
      role: "user",
      content: "file",
      attachments: [
        { type: "image", storageId: "image_1" },
        { type: "file", storageId: "file_1", mimeType: "application/pdf" },
        { type: "file", storageId: "missing_blob" },
        { type: "image", storageId: "missing_url" },
        { type: "file", url: "https://direct" },
      ],
    },
  ] as any);
  assert.equal(hydrated[1].attachments?.[0].url, "https://files/image_1");
  assert.match(hydrated[1].attachments?.[1].url ?? "", /^data:application\/pdf;base64,/);
  assert.equal(hydrated[1].attachments?.[2].url, undefined);
});

test("generated file and chart extraction skips malformed tool results and preserves metadata", () => {
  const files = extractGeneratedFiles([
    { toolName: "generate_docx", result: JSON.stringify({ storageId: "s1", filename: "report.docx", originalStorageId: "orig", title: "Report", summary: "Done" }), isError: false },
    { toolName: "data_python_exec", result: JSON.stringify({ exportedFiles: [{ storageId: "s2", filename: "data.csv", sizeBytes: 12, toolName: "custom" }] }), isError: false },
    { toolName: "generate_text_file", result: JSON.stringify({ newStorageId: "s3", filename: "README.unknown" }), isError: false },
    { toolName: "generate_pdf", result: "{bad json", isError: false },
    { toolName: "generate_docx", result: "{}", isError: true },
  ] as any);
  assert.equal(files.length, 3);
  assert.equal(files[0]?.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(files[1]?.mimeType, "text/csv");
  assert.equal(files[2]?.mimeType, "application/octet-stream");

  const charts = extractGeneratedCharts([
    { toolName: "data_python_exec", result: JSON.stringify({ chartsCreated: [
      { chartType: "line", elements: [{ x: 1 }], title: "Line", xLabel: "x", yLabel: "y", xUnit: "s", yUnit: "m", pngBase64: "abc" },
      { chartType: "bad", elements: [] },
      { chartType: "pie", elements: "not-array" },
    ] }), isError: false },
    { toolName: "generate_docx", result: "{}", isError: false },
    { toolName: "data_python_sandbox", result: "{bad json", isError: false },
  ] as any);
  assert.equal(charts.length, 1);
  assert.equal(charts[0]?.chartType, "line");
  assert.equal(charts[0]?.pngBase64, "abc");
});

test("scheduled job tools cover Pro gating, defaults, descriptions, lookup ambiguity, and update mapping", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const jobs = [
    { _id: "job_1", name: "Morning Digest", status: "active", recurrence: { type: "daily", hourUTC: 8, minuteUTC: 5 }, nextRunAt: 1, totalRuns: 2 },
    { _id: "job_2", name: "Morning Report", status: "paused", recurrence: { type: "weekly", dayOfWeek: 9, hourUTC: 9, minuteUTC: 0 } },
  ];
  const toolCtx = {
    userId: "user_1",
    ctx: {
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("userId" in args && args.userId === "free") return false;
        if (args.userId === "user_1" && mutations.length === 0) return true;
        if (args.userId === "user_1" && mutations.length > 0) return jobs;
        return "model/default";
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return "job_new";
      },
    },
  } as any;

  assert.equal((await createScheduledJob.execute({ ...toolCtx, userId: "free" }, { name: "x", recurrence: { type: "manual" }, prompt: "p", modelId: "m" })).success, false);
  assert.equal((await createScheduledJob.execute(toolCtx, { recurrence: { type: "manual" }, prompt: "p", modelId: "m" })).error, "Missing or empty 'name'");
  assert.equal((await createScheduledJob.execute(toolCtx, { name: "Job", recurrence: { type: "manual" } })).error, "Provide either a non-empty 'prompt' or non-empty 'steps' array.");

  const created = await createScheduledJob.execute(toolCtx, {
    name: "  Weekly Brief  ",
    steps: [{ title: "One", prompt: "Do it", modelId: "m", personaId: "persona_1", enabledIntegrations: ["gmail"], searchMode: "invalid", searchComplexity: 2 }],
    recurrence: { type: "cron", expression: "0 9 * * 1" },
  });
  assert.equal(created.success, true);
  assert.equal((created.data as any).stepCount, 1);

  const listed = await listScheduledJobs.execute(toolCtx, {});
  assert.equal((listed.data as any).count, 2);
  assert.match((listed.data as any).jobs[1].schedule, /day 9/);

  const ambiguousDelete = await deleteScheduledJob.execute(toolCtx, { jobName: "Morning" });
  assert.equal(ambiguousDelete.success, false);
  assert.deepEqual((ambiguousDelete.data as any).ambiguousMatches, ["Morning Digest", "Morning Report"]);
  assert.equal((await deleteScheduledJob.execute(toolCtx, { jobId: "missing" })).success, false);
  assert.equal((await deleteScheduledJob.execute(toolCtx, { jobId: "job_1" })).success, true);

  const updated = await updateScheduledJob.execute(toolCtx, {
    jobName: "Report",
    name: "Renamed",
    personaId: "",
    targetFolderId: "",
    status: "paused",
    steps: [{ prompt: "Step", modelId: "m", personaId: "persona_1", searchMode: "web", knowledgeBaseFileIds: ["s1"] }],
  });
  assert.equal(updated.success, true);
  assert.equal(mutations.at(-1)?.personaId, null);
  assert.equal(mutations.at(-1)?.targetFolderId, null);
});

test("scheduled job update tool covers lookup, status, step, and mutation failure branches", async () => {
  const jobs = [
    { _id: "job_1", name: "Daily Brief" },
    { _id: "job_2", name: "Daily Research" },
    { _id: "job_3", name: "Weekly Review" },
  ];

  const makeCtx = (options: { isPro?: boolean; throwMutation?: unknown } = {}) => {
    const mutations: Array<Record<string, unknown>> = [];
    let queryCall = 0;
    return {
      mutations,
      toolCtx: {
        userId: "user_1",
        ctx: {
          runQuery: async () => {
            queryCall += 1;
            return queryCall === 1 ? (options.isPro ?? true) : jobs;
          },
          runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
            if (options.throwMutation) throw options.throwMutation;
            mutations.push(args);
          },
        },
      } as any,
    };
  };

  assert.equal((await updateScheduledJob.execute(makeCtx({ isPro: false }).toolCtx, { jobId: "job_1" })).success, false);
  assert.equal((await updateScheduledJob.execute(makeCtx().toolCtx, {})).error, "Provide either 'jobId' or 'jobName'.");
  assert.match((await updateScheduledJob.execute(makeCtx().toolCtx, { jobId: "missing" })).error ?? "", /No scheduled job/);
  assert.match((await updateScheduledJob.execute(makeCtx().toolCtx, { jobName: "monthly" })).error ?? "", /No scheduled job/);
  const ambiguous = await updateScheduledJob.execute(makeCtx().toolCtx, { jobName: "daily" });
  assert.equal(ambiguous.success, false);
  assert.deepEqual((ambiguous.data as any).ambiguousMatches, ["Daily Brief", "Daily Research"]);

  const thrown = await updateScheduledJob.execute(makeCtx({ throwMutation: "offline" }).toolCtx, { jobName: "weekly" });
  assert.equal(thrown.success, false);
  assert.match(thrown.error ?? "", /offline/);

  const { toolCtx, mutations } = makeCtx();
  const updated = await updateScheduledJob.execute(toolCtx, {
    jobId: "job_3",
    name: 7,
    prompt: "Prompt",
    modelId: "model",
    personaId: " persona_2 ",
    targetFolderId: " folder_1 ",
    status: "other",
    steps: [
      {
        title: 42,
        prompt: "Step",
        modelId: "model",
        enabledIntegrations: "gmail",
        turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
        turnIntegrationOverrides: [{ integrationId: "gmail", enabled: true }],
        webSearchEnabled: true,
        searchMode: "none",
        searchComplexity: 0,
        knowledgeBaseFileIds: "bad",
        includeReasoning: true,
        reasoningEffort: "medium",
      },
    ],
  });
  assert.equal(updated.success, true);
  assert.equal(mutations[0]?.status, undefined);
  assert.equal((mutations[0]?.steps as any[])[0].title, undefined);
  assert.equal((mutations[0]?.steps as any[])[0].enabledIntegrations, undefined);
  assert.deepEqual((mutations[0]?.steps as any[])[0].turnIntegrationOverrides, [{ integrationId: "gmail", enabled: true }]);
});
