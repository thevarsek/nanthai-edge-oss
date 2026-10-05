import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import { getMySummary } from "../runtime_host/connection_summary";
import { connectionKind } from "../runtime_host/identity_projection";
import { createPermissionFixture } from "./runtime_host_permission_fixture";

const handler = (getMySummary as unknown as { _handler: (ctx: QueryCtx) => Promise<{ status: string; pairedCount: number; readyCount: number; deviceName: string | null }> })._handler;

test("connection summary distinguishes ready, signed-out, offline and unpaired owned computers", async () => {
  const state = await createPermissionFixture();
  const ctx = { ...state.ctx, auth: { getUserIdentity: async () => ({ subject: "user_1" }) }, runQuery: async () => false } as unknown as QueryCtx;
  state.rows.runtimeDevices.push({ _id: "other-device", deviceId: "other", userId: "other-user", status: "active" });
  assert.deepEqual(await handler(ctx), { status: "online", pairedCount: 1, readyCount: 1, deviceName: "Dino MacBook", setupPending: false, downloadUrl: null, questionTimeoutMinutes: 15 });
  (state.rows.runtimeDevicePresences[0].adapters as Array<{ authState: string }>)[0].authState = "signed_out";
  assert.equal((await handler(ctx)).status, "needs_attention");
  state.rows.runtimeDevicePresences[0].expiresAt = Date.now() - 1;
  assert.equal((await handler(ctx)).status, "offline");
  state.rows.runtimeDevices[0].status = "revoked";
  assert.deepEqual(await handler(ctx), { status: "not_paired", pairedCount: 0, readyCount: 0, deviceName: null, setupPending: false, downloadUrl: null, questionTimeoutMinutes: 15 });
});

test("shared setup projection resumes only incomplete local onboarding and exposes the operator download", async () => {
  const state = await createPermissionFixture();
  state.rows.userPreferences = [{ _id: "prefs", userId: "user_1", runtimeOnboardingState: "setup", onboardingCompleted: false }];
  const ctx = { ...state.ctx, auth: { getUserIdentity: async () => ({ subject: "user_1" }) }, runQuery: async () => false } as unknown as QueryCtx;
  const previous = process.env.NANTHAI_RUNTIME_HOST_DOWNLOAD_URL;
  process.env.NANTHAI_RUNTIME_HOST_DOWNLOAD_URL = "https://example.com/NanthAI.zip";
  try {
    const summary = await handler(ctx) as Awaited<ReturnType<typeof handler>> & { setupPending: boolean; downloadUrl: string };
    assert.equal(summary.setupPending, true);
    assert.equal(summary.downloadUrl, "https://example.com/NanthAI.zip");
    state.rows.userPreferences[0].onboardingCompleted = true;
    assert.equal((await handler(ctx) as typeof summary).setupPending, false);
  } finally {
    if (previous === undefined) delete process.env.NANTHAI_RUNTIME_HOST_DOWNLOAD_URL;
    else process.env.NANTHAI_RUNTIME_HOST_DOWNLOAD_URL = previous;
  }
});

test("chat identity distinguishes local, OpenRouter and mixed groups", () => {
  assert.equal(connectionKind([]), null);
  assert.equal(connectionKind([{ runtimePlacement: "local" }]), "local");
  assert.equal(connectionKind([{ runtimePlacement: "cloud" }]), "openrouter");
  assert.equal(connectionKind([{ runtimePlacement: "local" }, { runtimePlacement: "cloud" }]), "mixed");
});
