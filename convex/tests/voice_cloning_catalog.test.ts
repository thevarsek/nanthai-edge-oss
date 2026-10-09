import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import { listModelSummaries } from "../models/queries";

test("cloning-only model summaries follow endpoint capabilities and the request policy", async () => {
  const rows = [
    { modelId: "fish-audio/s2-pro", name: "Ordinary speech", architecture: { modality: "text->speech" },
      speechCapabilities: { endpoints: [{ supportsVoiceCloning: false, supportsZdr: true }] } },
    { modelId: "fish-audio/s2.1-pro", name: "Cloning", architecture: { modality: "text->speech" },
      speechCapabilities: { endpoints: [{ supportsVoiceCloning: true, supportsZdr: false }] } },
    { modelId: "seed/voice", name: "Protected cloning", architecture: { modality: "text->speech" },
      speechCapabilities: { endpoints: [{ supportsVoiceCloning: true, supportsZdr: true }] } },
  ];
  const ctx = { auth: { getUserIdentity: async () => null }, db: { query: () => ({ take: async () => rows }) } } as unknown as QueryCtx;
  const handler = (listModelSummaries as unknown as { _handler: (ctx: QueryCtx, args: {
    includeGenerationModels: boolean; voiceCloning?: { requireZdr: boolean };
  }) => Promise<Array<{ modelId: string }>> })._handler;
  assert.deepEqual((await handler(ctx, { includeGenerationModels: true })).map(row => row.modelId), rows.map(row => row.modelId));
  assert.deepEqual((await handler(ctx, { includeGenerationModels: true, voiceCloning: { requireZdr: false } })).map(row => row.modelId), ["fish-audio/s2.1-pro", "seed/voice"]);
  assert.deepEqual((await handler(ctx, { includeGenerationModels: true, voiceCloning: { requireZdr: true } })).map(row => row.modelId), ["seed/voice"]);
});
