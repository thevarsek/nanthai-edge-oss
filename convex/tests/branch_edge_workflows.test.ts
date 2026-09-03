import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFirstTextFromUnknown,
  extractImageUrlsFromUnknown,
  extractTextAndImages,
  normalizeImageUrl,
  usageFromUnknown,
} from "../lib/openrouter_extract";
import {
  extractQueryStrings,
  parseAnalysisArtifact,
  parsePlanningArtifact,
  parseStructuredArtifact,
  summarizeSearchResults,
} from "../search/research_artifacts";
import { createTool, ToolRegistry } from "../tools/registry";
import {
  availableProgressiveProfiles,
  buildRegistryParams,
  extractLoadedSkillsFromConversation,
  extractLoadedSkillsFromLoadSkillResults,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  mergeLoadedSkills,
  patchDeferredProgressiveToolErrors,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry_shared";
import { upsertImageModelsBatch } from "../models/image_sync";
import { upsertVideoModelsBatch } from "../models/video_sync";

function preparedImageModel(modelId: string, imageOnly: boolean, pricePerImage: number) {
  const provider = modelId.split("/")[0] ?? "unknown";
  return {
    modelId,
    imageOnly,
    name: modelId,
    provider,
    canonicalSlug: modelId,
    supportedParameters: [],
    architecture: { modality: imageOnly ? "text->image" : "text->text+image" },
    imageCapabilities: {
      pricePerImage,
      supportedParameters: {},
      supportsStreaming: false,
      allowedPassthroughParameters: [],
      pricing: [],
    },
  };
}

test("OpenRouter extraction helpers cover text, images, recursive values, and usage detail branches", () => {
  const base64 = "a".repeat(68);
  assert.equal(normalizeImageUrl("  https://example.com/a.png  "), "https://example.com/a.png");
  assert.equal(normalizeImageUrl(` ${base64} `), `data:image/png;base64,${base64}`);
  assert.equal(normalizeImageUrl(" data:image/png;base64,abc "), "data:image/png;base64,abc");
  assert.equal(normalizeImageUrl("not base64"), "not base64");

  const extracted = extractTextAndImages([
    null,
    { type: "text", text: "Hello " },
    { type: "output_text", text: "world" },
    { type: "image_url", image_url: { url: base64, b64_json: "b".repeat(70) } },
    { type: "input_image", image_base64: "c".repeat(70) },
    { type: "input_image", data: "" },
  ]);
  assert.equal(extracted.text, "Hello world");
  assert.equal(extracted.imageUrls.length, 3);
  assert.deepEqual(extractTextAndImages("plain"), { text: "plain", imageUrls: [] });
  assert.deepEqual(extractTextAndImages(42), { imageUrls: [] });

  assert.deepEqual(extractImageUrlsFromUnknown([
    { url: "https://example.com/1.png" },
    { image_url: { url: "https://example.com/2.png" } },
    { image: { base64 } },
    false,
  ]).slice(0, 3), [
    "https://example.com/1.png",
    "https://example.com/2.png",
    `data:image/png;base64,${base64}`,
  ]);

  const usage = usageFromUnknown({
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
    cost: 0.02,
    is_byok: true,
    prompt_tokens_details: {
      cached_tokens: 3,
      cache_write_tokens: 2,
      audio_tokens: 1,
      video_tokens: 5,
    },
    completion_tokens_details: {
      reasoning_tokens: 6,
      image_tokens: 7,
      audio_tokens: 8,
    },
    cost_details: {
      upstream_inference_cost: 0.01,
      upstream_inference_prompt_cost: 0.002,
      upstream_inference_completions_cost: 0.008,
      cache_discount: -0.001,
    },
    server_tool_use: { web_search_requests: 2 },
  });
  assert.equal(usage?.cacheDiscount, -0.001);
  assert.equal(usage?.webSearchRequests, 2);
  assert.equal(usageFromUnknown({ cost: 1 }), undefined);
  assert.equal(usageFromUnknown(null), undefined);

  assert.equal(extractFirstTextFromUnknown({ choices: [{ delta: { content: " nested " } }] }), "nested");
  assert.equal(extractFirstTextFromUnknown(["", { message: "fallback" }]), "fallback");
  assert.equal(extractFirstTextFromUnknown({ content: [{ type: "text", text: "array text" }] }), "array text");
  assert.equal(extractFirstTextFromUnknown({ content: null }), undefined);
});

test("research artifact parsers normalize malformed and structured planning data", () => {
  const planning = parsePlanningArtifact(JSON.stringify({
    paperType: "survey",
    discipline: "cs",
    audience: "engineers",
    citationStyle: "apa",
    researchQuestion: "How?",
    scope: { inScope: "AI", outOfScope: ["ads"], assumptions: ["mobile"] },
    keyConcepts: [{ concept: "agents", synonyms: ["workers"] }, { bad: true }],
    inclusionCriteria: ["recent"],
    exclusionCriteria: "irrelevant",
    plan: "Search broadly",
    queries: [
      "agent orchestration",
      { query: "Agent orchestration", rationale: "duplicate" },
      { query: "mobile agents", targetConcepts: ["mobile"], gapAddressed: "platform" },
    ],
  }), "fallback", 5);
  assert.equal(planning.queries.length, 2);
  assert.deepEqual(planning.scope.inScope, ["AI"]);
  assert.equal(planning.keyConcepts[0]?.concept, "agents");

  const fallbackPlanning = parsePlanningArtifact("not json", "fallback topic", 2);
  assert.equal(fallbackPlanning.queries[0]?.query, "fallback topic");

  const analysis = parseAnalysisArtifact(JSON.stringify({
    gaps: "Thin evidence",
    contradictionGaps: "conflict",
    methodologyGaps: ["small sample"],
    populationOrContextGaps: ["mobile"],
    queries: [{ query: "more evidence", gapAddressed: "evidence" }],
  }), "topic", 1);
  assert.equal(analysis.coverageSummary, "Thin evidence");
  assert.deepEqual(analysis.contradictionGaps, ["conflict"]);

  assert.deepEqual(parseStructuredArtifact("", { fallback: true }), { fallback: true });
  assert.equal(parseStructuredArtifact("raw text", { fallback: true }).rawText, "raw text");
  assert.deepEqual(extractQueryStrings(["a", { query: "b" }, { query: "" }, 5]), ["a", "b"]);
  assert.match(summarizeSearchResults([
    { success: false, query: "bad", content: "", citations: [] } as any,
    { success: true, query: "good", content: "abcdef", citations: ["https://a"] } as any,
  ], 3), /abc\nSources/);
});

test("progressive registry helpers parse loaded skills and patch same-round tool errors", async () => {
  const registry = new ToolRegistry();
  const retryTool = createTool({
    name: "read_document",
    description: "Read",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { retried: true } }),
  });
  registry.register(retryTool);

  assert.deepEqual(buildRegistryParams(new ToolRegistry()), {});
  assert.equal(buildRegistryParams(registry).toolChoice, "auto");
  assert.deepEqual(availableProgressiveProfiles({
    isPro: true,
    allowSubagents: true,
    enabledIntegrations: ["gmail", "outlook", "notion", "apple_calendar", "cloze", "slack"],
  }).sort(), [
    "analytics", "appleCalendar", "cloze", "docs", "google", "imageGeneration",
    "microsoft", "musicGeneration", "presentations", "notion", "persistentRuntime",
    "scheduledJobs", "skillsManagement", "slack", "speechGeneration", "subagents",
    "videoGeneration", "workspace",
  ].sort());
  assert.deepEqual(availableProgressiveProfiles({ isPro: false }), []);

  const loadCall = { id: "call_load", function: { name: "load_skill", arguments: "{}" } };
  const earlyCall = { id: "call_read", function: { name: "read_document", arguments: "{}" } };
  const loadedData = {
    skill: "docx",
    name: "DOCX",
    runtimeMode: "toolAugmented",
    instructions: "Use document tools",
    requiredToolProfiles: ["docs", "unknown"],
    requiredToolIds: ["read_docx"],
    requiredIntegrationIds: [],
    requiredCapabilities: ["pro"],
  };
  const results = [
    { toolCallId: "call_load", result: { success: true, data: loadedData } },
    { toolCallId: "call_read", result: { success: false, data: null, error: 'Unknown tool: "read_document".' } },
  ];

  assert.deepEqual(extractProfilesFromLoadSkillResults([loadCall, earlyCall], results as any), ["docs"]);
  assert.equal(extractLoadedSkillsFromLoadSkillResults([loadCall, earlyCall], results as any)[0]?.skill, "docx");
  patchSameRoundProgressiveToolErrors([loadCall, earlyCall], results as any, registry);
  assert.equal((results[1].result.data as any).retryNextTurn, true);
  patchDeferredProgressiveToolErrors([loadCall, earlyCall], results as any);

  results[1] = { toolCallId: "call_read", result: { success: false, data: null, error: 'Unknown tool: "read_document".' } };
  await retrySameRoundProgressiveToolCalls([loadCall, earlyCall] as any, results as any, registry, {} as any);
  assert.equal((results[1].result.data as any).retried, true);

  const messages = [
    { role: "assistant", tool_calls: [loadCall] },
    { role: "tool", tool_call_id: "call_load", content: JSON.stringify(loadedData) },
    { role: "tool", tool_call_id: "ignored", content: "not json" },
    { role: "tool", tool_call_id: "call_load", content: [{ type: "text", text: JSON.stringify({ ...loadedData, skill: "xlsx", requiredToolIds: ["generate_xlsx"] }) }] },
  ];
  assert.deepEqual(extractProfilesFromConversation(messages as any), ["docs"]);
  assert.deepEqual(extractLoadedSkillsFromConversation(messages as any).map((skill) => skill.skill), ["docx", "xlsx"]);
  assert.deepEqual(mergeLoadedSkills([{ ...loadedData, skill: "docx", instructions: "old", requiredToolProfiles: ["docs"] as any }], [{ ...loadedData, skill: "docx", instructions: "new" } as any])[0]?.instructions, "new");
});

test("model media batch mutations cover existing and created paths", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const existing = new Map<string, any>([
    ["video/existing", { _id: "video_existing", architecture: { tokenizer: "tok" } }],
    ["image/existing", { _id: "image_existing" }],
    ["multi/existing", { _id: "multi_existing" }],
  ]);
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_index: string, apply?: (q: any) => unknown) => {
          let modelId = "";
          apply?.({ eq: (_field: string, value: string) => { modelId = value; return {}; } });
          return { first: async () => existing.get(modelId) ?? null };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
    },
  } as any;

  const videoResult = await (upsertVideoModelsBatch as any)._handler(ctx, {
    models: [
      {
        modelId: "video/existing",
        name: "Video Existing",
        provider: "video",
        videoCapabilities: { supportedFrameImages: ["first_frame"], supportedResolutions: [], supportedAspectRatios: [], supportedDurations: [], supportedSizes: [], generateAudio: true, seed: false, syncedAt: 1 },
      },
      {
        modelId: "video/new",
        name: "Video New",
        provider: "video",
        videoCapabilities: { supportedFrameImages: [], supportedResolutions: [], supportedAspectRatios: [], supportedDurations: [], supportedSizes: [], generateAudio: false, seed: true, syncedAt: 1 },
      },
    ],
  });
  assert.deepEqual(videoResult, { patched: 1, created: 1 });
  assert.equal((patches[0]?.patch.architecture as { modality?: string } | undefined)?.modality, "text+image->video");
  assert.equal((inserts[0]?.value.architecture as { modality?: string } | undefined)?.modality, "text->video");

  const imageResult = await (upsertImageModelsBatch as any)._handler(ctx, {
    models: [
      preparedImageModel("image/existing", true, 0.1),
      preparedImageModel("image/new", true, 0.2),
      preparedImageModel("multi/existing", false, 0.3),
      preparedImageModel("multi/missing", false, 0.4),
    ],
  });
  assert.deepEqual(imageResult, { upserted: 4, created: 2 });
  assert.ok(patches.some((entry) => entry.id === "multi_existing" && entry.patch.imageCapabilities));
  assert.ok(inserts.some((entry) => entry.value.modelId === "image/new"));
  const insertedHybrid = inserts.find((entry) =>
    entry.value.modelId === "multi/missing"
  )?.value;
  assert.ok(insertedHybrid);
  assert.equal(
    (insertedHybrid.imageCapabilities as { managedByImageSync?: boolean })
      .managedByImageSync,
    false,
  );
});
