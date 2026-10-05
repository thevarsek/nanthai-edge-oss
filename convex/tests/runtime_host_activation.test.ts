import assert from "node:assert/strict";
import test from "node:test";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { begin } from "../runtime_host/activation";
import { terminalizeRuntimeChatTurn } from "../runtime_host/chat_terminal_ingestion";
import { createPermissionFixture } from "./runtime_host_permission_fixture";

for (const outcome of ["completed", "failed", "cancelled"] as const) {
  test(`local setup becomes ready only when the real turn completes: ${outcome}`, async () => {
    const { ctx, rows, now } = await createPermissionFixture();
    rows.purchaseEntitlements = [{ _id: "entitlement-1", userId: "user_1", status: "active" }];
    rows.userPreferences = [{ _id: "prefs-1", userId: "user_1", onboardingCompleted: false }];
    const authCtx = { db: ctx.db, auth: { getUserIdentity: async () => ({ subject: "user_1" }) } } as unknown as MutationCtx;
    await (begin as unknown as { _handler: (ctx: MutationCtx) => Promise<void> })._handler(authCtx);
    assert.equal(rows.userPreferences[0].runtimeOnboardingState, "setup");
    assert.equal(rows.userPreferences[0].onboardingCompleted, false);
    await terminalizeRuntimeChatTurn(ctx, {
      host: { credential: rows.runtimeDeviceCredentials[0] as Doc<"runtimeDeviceCredentials">, device: rows.runtimeDevices[0] as Doc<"runtimeDevices">, claimantId: "runtime-host:device-1:presence-1" },
      run: rows.executionRuns[0] as Doc<"executionRuns">,
      attempt: rows.executionAttempts[0] as Doc<"executionAttempts">,
      job: rows.generationJobs[0] as Doc<"generationJobs">,
      command: rows.runtimeCommands[0] as Doc<"runtimeCommands">,
    }, { protocolVersion: "nanthai.runtime.v1", eventId: "terminal-1", sequence: 1, occurredAt: now, runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1", type: "terminal", outcome, summary: outcome, errorCode: null, checkpointRef: null, nativeTurnId: "native-turn-1" });
    assert.equal(rows.userPreferences[0].runtimeOnboardingState, outcome === "completed" ? "ready" : "setup");
    assert.equal(rows.userPreferences[0].onboardingCompleted, outcome === "completed");
  });
}
