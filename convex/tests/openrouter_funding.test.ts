import assert from "node:assert/strict";
import test from "node:test";
import { fundingAwareSearchDefault, fundingState, isFreeOpenRouterModel, parseAccountSnapshot, projectModelFunding, resolveFreeModel, type AccountSnapshot } from "../openrouter/funding_policy";
import { MODEL_IDS } from "../lib/model_constants";
import { openRouterErrorDetails } from "../lib/openrouter_error";
import { generationRecovery } from "../chat/generation_recovery";
import { saveSnapshot } from "../openrouter/account";

const now = 1_000_000;
const snapshot = (patch: Partial<AccountSnapshot> = {}): AccountSnapshot => ({ balance: 0, keyLimitRemaining: null, keyLimitKnown: true, keyLimitReset: null, checkedAt: now, ...patch });
const free = { modelId: MODEL_IDS.freeDefault, contextLength: 200000, architecture: { modality: "text+image->text" }, supportsTools: true };
const zdr = { ...free, modelId: MODEL_IDS.freeZdrDefault, hasZdrEndpoint: true };
const paid = { ...free, modelId: MODEL_IDS.appDefault, hasZdrEndpoint: true };

test("failed, partial, stale and future account checks are not empty balances", () => {
  for (const s of [undefined, snapshot({ checkedAt: now - 300001 }), snapshot({ checkedAt: now + 1 }), snapshot({ balance: null, keyLimitKnown: false }), snapshot({ balance: 5, keyLimitKnown: false })]) assert.equal(fundingState(s, now), "unknown");
  assert.equal(fundingState(snapshot(), now), "no_credits");
  assert.equal(fundingState(snapshot({ balance: 5 }), now), "funded");
  assert.equal(fundingState(snapshot({ balance: 5, keyLimitRemaining: 0 }), now), "key_limit");
  assert.equal(fundingState(snapshot({ balance: -1, keyLimitRemaining: 0 }), now), "negative_balance");
});
test("account parsing preserves negative balance and unlimited keys, never invents zero", () => {
  assert.deepEqual(parseAccountSnapshot({ data: { total_credits: 3, total_usage: 4 } }, { data: { limit: null } }, now), snapshot({ balance: -1 }));
  assert.equal(parseAccountSnapshot(null, null, now).balance, null);
  assert.equal(parseAccountSnapshot({ data: { total_credits: "3", total_usage: 0 } }, null, now).balance, null);
  assert.equal(parseAccountSnapshot(null, { data: { limit_remaining: 0, limit_reset: "daily" } }, now).keyLimitKnown, true);
});
test("free routing selects explicit free chat routes and enforces real ZDR capability", () => {
  assert.equal(isFreeOpenRouterModel(MODEL_IDS.freeDefault), true);
  assert.equal(isFreeOpenRouterModel("paid/free-looking-model"), false);
  assert.equal(resolveFreeModel([paid, free, zdr], false), free.modelId);
  assert.equal(resolveFreeModel([paid, free, zdr], true), zdr.modelId);
  assert.equal(resolveFreeModel([free, { ...zdr, hasZdrEndpoint: false }], true), undefined);
  assert.equal(resolveFreeModel([{ ...zdr, provider: "disabled" }], true, ["disabled"]), undefined);
  assert.equal(resolveFreeModel([{ ...zdr, architecture: { modality: "text->audio" } }], true), undefined);
});
test("guidance does not block sends, alter selections or relax privacy", () => {
  for (const state of ["unknown", "funded"] as const) assert.equal(projectModelFunding(paid, state, free.modelId, false), undefined);
  assert.equal(projectModelFunding(free, "no_credits", free.modelId, false), undefined);
  assert.equal(projectModelFunding(zdr, "key_limit", zdr.modelId, true), undefined);
  assert.deepEqual(projectModelFunding(paid, "no_credits", zdr.modelId, true), { code: "no_credits", freeModelId: zdr.modelId, actions: ["openrouter_credits", "choose_free_model"] });
  assert.deepEqual(projectModelFunding(free, "negative_balance", free.modelId, false), { code: "negative_balance", actions: ["openrouter_credits"] });
  assert.deepEqual(projectModelFunding(paid, "no_credits", undefined, true)?.actions, ["openrouter_credits", "privacy_settings"]);
});
test("402 metadata distinguishes temporary reservations, key limits, and request budgets", () => {
  for (const [source, reason, code, actions] of [
    ["openrouter_in_flight_budget", undefined, "OPENROUTER_SPENDING_RESERVED", undefined],
    ["openrouter_key_limit", undefined, "OPENROUTER_KEY_LIMIT", ["openrouter_keys", "change_model"]],
    ["openrouter_credits", "weight_exceeds_budget", "OPENROUTER_REQUEST_TOO_EXPENSIVE", ["change_model", "openrouter_credits"]],
  ] as const) {
    const result = openRouterErrorDetails(402, "secret provider text", { error: { metadata: { limit_source: source, reason } } });
    assert.equal(result.code, code);
    assert.doesNotMatch(result.message, /secret provider text/);
    assert.deepEqual(generationRecovery({ role: "assistant", status: "failed", content: JSON.stringify(result) })?.actions, actions);
  }
  assert.equal(openRouterErrorDetails(402, "", "malformed").code, "INSUFFICIENT_CREDITS");
});
test("late account reads cannot overwrite a new connection, newer snapshot or deleted account", async () => {
  type Handler = (ctx: unknown, args: unknown) => Promise<boolean>;
  const handler = (saveSnapshot as unknown as { _handler: Handler })._handler;
  let patches = 0;
  const args = { connectionId: "connection", connectionUpdatedAt: 10, snapshot: snapshot() };
  for (const connection of [null, { updatedAt: 11 }, { updatedAt: 10, openRouterAccount: snapshot({ checkedAt: now + 1 }) }]) {
    assert.equal(await handler({ db: { get: async () => connection, patch: async () => { patches++; } } }, args), false);
  }
  assert.equal(patches, 0);
  assert.equal(await handler({ db: { get: async () => ({ _id: "connection", updatedAt: 10 }), patch: async () => { patches++; } } }, args), true);
  assert.equal(patches, 1);
});

test("public defaults and removable free filter are one funding-aware projection", async () => {
  const { getPreferences } = await import("../preferences/queries");
  type Handler = (ctx: unknown, args: unknown) => Promise<Record<string, unknown>>;
  const handler = (getPreferences as unknown as { _handler: Handler })._handler;
  for (const [patch, expectedModel, expectedFilter] of [
    [{}, free.modelId, true],
    [{ zdrEnabled: true }, zdr.modelId, true],
    [{ defaultModelId: paid.modelId }, paid.modelId, true],
    [{ pickerFilterFree: false, pickerFilterFreeUserSet: true }, free.modelId, false],
    [{ webSearchDefaultUserSet: true }, free.modelId, true],
  ] as const) {
    const prefs = { userId: "user", pickerFilterFree: false, webSearchEnabledByDefault: true, ...patch };
    const context = {
      auth: { getUserIdentity: async () => ({ subject: "user" }) },
      db: { query: (table: string) => ({
        take: async () => [free, zdr, paid],
        withIndex: () => ({
          first: async () => table === "userPreferences" ? prefs : null,
          unique: async () => table === "userSecrets" ? { openRouterAccount: snapshot({ checkedAt: Date.now() }) } : null,
        }),
      }) },
    };
    const result = await handler(context, {});
    assert.equal(result.defaultModelId, expectedModel);
    assert.equal(result.webSearchEnabledByDefault, "defaultModelId" in patch || "webSearchDefaultUserSet" in patch);
    assert.equal(result.pickerFilterFree, expectedFilter);
    assert.equal(result.zdrEnabled, "zdrEnabled" in patch ? true : undefined);
  }
});


test("free router with ZDR reports privacy conflict regardless of account balance", () => {
  for (const state of ["no_credits", "key_limit", "unknown", "funded"] as const) {
    assert.deepEqual(projectModelFunding(free, state, zdr.modelId, true), {
      code: "zdr_incompatible", freeModelId: zdr.modelId,
      actions: ["choose_free_model", "privacy_settings"],
    });
  }
  assert.deepEqual(projectModelFunding(free, "no_credits", undefined, true)?.actions, ["privacy_settings"]);
});


test("search is off only for automatic free defaults and explicit overrides remain usable", () => {
  const prefs = {webSearchEnabledByDefault: true};
  assert.equal(fundingAwareSearchDefault(prefs, "no_credits", free.modelId), false);
  assert.equal(fundingAwareSearchDefault({...prefs, defaultModelId: free.modelId}, "no_credits", free.modelId), true);
  assert.equal(fundingAwareSearchDefault({...prefs, webSearchDefaultUserSet: true}, "no_credits", free.modelId), true);
  assert.equal(fundingAwareSearchDefault(prefs, "funded", free.modelId), true);
  assert.equal(fundingAwareSearchDefault(prefs, "unknown", free.modelId), true);
  assert.equal(fundingAwareSearchDefault(prefs, "no_credits", undefined), true);
});
