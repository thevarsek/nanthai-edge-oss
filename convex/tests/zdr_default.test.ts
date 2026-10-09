import assert from "node:assert/strict";
import test from "node:test";
import { defaultModelWhenEnablingZdr } from "../preferences/zdr_default";
import type { MutationCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
const models = [
  { modelId: MODEL_IDS.appDefault, hasZdrEndpoint: true, provider: "openai" },
  { modelId: MODEL_IDS.freeZdrDefault, hasZdrEndpoint: true, provider: "apodex", contextLength: 262144, architecture: { modality: "text->text" } },
  { modelId: "paid/incompatible", hasZdrEndpoint: false },
  { modelId: MODEL_IDS.freeDefault, hasZdrEndpoint: false },
];
function context(balance: number | null) {
  return { db: { query: () => ({ take: async () => models, withIndex: () => ({ unique: async () => ({ openRouterAccount: { balance, keyLimitRemaining: null, keyLimitKnown: true, keyLimitReset: null, checkedAt: Date.now() } }) }) }) } } as unknown as Pick<MutationCtx, "db">;
}
test("paid incompatible default uses the app default, free or empty account uses free ZDR", async () => {
  for (const balance of [10, null]) assert.deepEqual(await defaultModelWhenEnablingZdr(context(balance), "user", { defaultModelId: "paid/incompatible" }), {defaultModelId: MODEL_IDS.appDefault, disableSearch: false});
  assert.deepEqual(await defaultModelWhenEnablingZdr(context(0), "user", { defaultModelId: "paid/incompatible" }), {defaultModelId: MODEL_IDS.freeZdrDefault, disableSearch: true});
  assert.deepEqual(await defaultModelWhenEnablingZdr(context(10), "user", { defaultModelId: MODEL_IDS.freeDefault }), {defaultModelId: MODEL_IDS.freeZdrDefault, disableSearch: false});
  assert.equal(await defaultModelWhenEnablingZdr(context(0), "user", { defaultModelId: MODEL_IDS.appDefault }), undefined);
});
