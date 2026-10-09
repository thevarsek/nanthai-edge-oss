import assert from "node:assert/strict";
import test from "node:test";

import { isEligibleModel } from "../models/model_filters";
import { getModel, listModels, listModelSummaries, listModelsInternalForSync } from "../models/queries";

type TestFunction = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const textModel = {
  _id: "model", modelId: "openai/gpt-5", name: "GPT-5", provider: "openai",
  contextLength: 400_000.0, outputPricePer1M: 10.0,
  architecture: { modality: "text+image->text" }, lastSyncedAt: 1,
};
const rows = [
  textModel,
  { ...textModel, _id: "batch", modelId: "openai/gpt-5:batch" },
  { ...textModel, _id: "free", modelId: "openai/gpt-5:free" },
  { ...textModel, _id: "named_batch", modelId: "example/batch-helper", provider: "example" },
  { ...textModel, _id: "speech", modelId: "example/speech", contextLength: 0,
    architecture: { modality: "text->speech" } },
  { ...textModel, _id: "speech_batch", modelId: "example/speech:batch", contextLength: 0,
    architecture: { modality: "text->speech" } },
];

function context() {
  return { auth: { getUserIdentity: async () => null }, db: { query: () => ({
    take: async () => rows,
    collect: async () => rows,
    withIndex: (_index: string, apply: (q: { eq: (field: string, value: string) => void }) => void) => {
      let selected = rows;
      apply({ eq: (field, value) => {
        selected = rows.filter((row) => row[field as "provider" | "modelId"] === value);
      } });
      return { collect: async () => selected, first: async () => selected[0] ?? null };
    },
  }) } };
}

async function ids(fn: unknown, args: unknown = {}) {
  const result = await (fn as TestFunction)._handler(context(), args) as { modelId: string }[];
  return result.map((row) => row.modelId);
}

test("interactive catalogues omit batch routes while preserving ordinary variants", async () => {
  const expected = ["openai/gpt-5", "openai/gpt-5:free", "example/batch-helper"];
  assert.deepEqual(await ids(listModels), expected);
  assert.deepEqual(await ids(listModelSummaries), expected);
  assert.deepEqual(await ids(listModelSummaries, { provider: "openai" }), expected.slice(0, 2));
});

test("generation picker inclusion cannot restore asynchronous batch routes", async () => {
  assert.deepEqual(await ids(listModelSummaries, { includeGenerationModels: true }), [
    "openai/gpt-5", "openai/gpt-5:free", "example/batch-helper", "example/speech",
  ]);
  assert.equal(isEligibleModel({ ...rows[1], supportsVideo: true }), false);
  assert.equal(isEligibleModel({ ...rows[1], supportsImages: true,
    architecture: { modality: "text->image" } }), false);
});

test("batch catalogue records remain addressable for history and sync", async () => {
  const model = await (getModel as unknown as TestFunction)._handler(context(), {
    modelId: "openai/gpt-5:batch",
  }) as { modelId: string };
  assert.equal(model.modelId, "openai/gpt-5:batch");
  assert.deepEqual(await ids(listModelsInternalForSync), rows.map((row) => row.modelId));
});
