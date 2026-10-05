import assert from "node:assert/strict";
import test from "node:test";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { begin, canUseLocalController } from "../runtime_host/activation";
import { beginPairing } from "../runtime_host/pairing";
import { addBasicPersona } from "../runtime_host/basic_persona";
import { provisionStarterPersona } from "../runtime_host/starter_persona";

function fixture() {
  const now = Date.now();
  const rows: Record<string, Array<Record<string, unknown>>> = {
    userPreferences: [{ _id: "prefs", userId: "user_1", onboardingCompleted: false, runtimeOnboardingState: "setup" }],
    runtimeDevices: [{ _id: "device", userId: "user_1", deviceId: "mac", displayName: "Mac", status: "active", currentPresenceId: "presence" }],
    runtimeDevicePresences: [{ _id: "presence", status: "online", expiresAt: now + 60_000,
      adapters: [{ adapterId: "pi", authState: "ready" }] }],
    purchaseEntitlements: [],
  };
  const state = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const ctx = { db: state.db, auth: { getUserIdentity: async () => ({ subject: "user_1" }) } } as unknown as MutationCtx;
  return { rows, ctx, now };
}

const start = (begin as unknown as { _handler: (ctx: MutationCtx) => Promise<void> })._handler;
const pair = (beginPairing as unknown as { _handler: (ctx: MutationCtx, args: { shortCode: boolean }) => Promise<unknown> })._handler;
const add = (addBasicPersona as unknown as { _handler: (ctx: MutationCtx, args: { deviceId: string; adapterId: "pi" }) => Promise<unknown> })._handler;
const canEnter = (canUseLocalController as unknown as { _handler: (ctx: QueryCtx) => Promise<boolean> })._handler;

test("free local setup requires Pro before starting, pairing, or creating a Persona; retained controller access remains", async () => {
  const { rows, ctx, now } = fixture();
  for (const action of [() => start(ctx), () => pair(ctx, { shortCode: true }), () => add(ctx, { deviceId: "mac", adapterId: "pi" })]) {
    await assert.rejects(action, error => String(error).includes("PRO_REQUIRED"));
  }
  await provisionStarterPersona(ctx, rows.runtimeDevices[0] as Doc<"runtimeDevices">, now);
  assert.equal(rows.personas?.length ?? 0, 0);
  assert.equal(rows.runtimePairingRequests?.length ?? 0, 0);
  assert.equal(await canEnter(ctx), true, "existing setup/history must remain recoverable");
});

test("confirmed Pro resumes existing setup and provisions an editable nonempty local prompt without overwriting it", async () => {
  const { rows, ctx, now } = fixture();
  rows.purchaseEntitlements.push({ _id: "pro", userId: "user_1", status: "active" });
  await start(ctx);
  await pair(ctx, { shortCode: true });
  await provisionStarterPersona(ctx, rows.runtimeDevices[0] as Doc<"runtimeDevices">, now);
  assert.equal(rows.personas.length, 1);
  assert.equal(rows.personas[0].systemPrompt, "You are a helpful assistant.");
  rows.personas[0].systemPrompt = "My own assistant instructions.";
  await provisionStarterPersona(ctx, rows.runtimeDevices[0] as Doc<"runtimeDevices">, now + 1);
  assert.equal(rows.personas[0].systemPrompt, "My own assistant instructions.");
  assert.equal(rows.personas.length, 1);
  await add(ctx, { deviceId: "mac", adapterId: "pi" });
  assert.equal(rows.personas.length, 1, "recovery opens the existing Pi Persona");
  assert.equal(rows.personas[0].systemPrompt, "My own assistant instructions.");
});
