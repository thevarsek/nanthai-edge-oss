import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { getLocalGenerationDispatchContextHandler } from "../runtime_host/chat_dispatch_queries";
import { normalizeGenerationError } from "../chat/generation_error";

function fixture(adapterId: string, webSearch: boolean) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    generationJobs: [{ _id: "job", executionRunId: "run", executionAttemptId: "attempt",
      executionFence: 1, messageId: "assistant", chatId: "chat", userId: "user",
      effectivePersonaConfig: { personaId: "persona" } }],
    executionRuns: [{ _id: "run", sourceMessageId: "source", activeAttemptId: "attempt" }],
    executionAttempts: [{ _id: "attempt", fence: 1, placement: "local",
      executorKind: "local_runtime", chatParticipantId: "participant",
      routeSnapshotHash: "route", deviceId: "device", adapterId }],
    messages: [{ _id: "source", chatId: "chat" }, { _id: "assistant", chatId: "chat" }],
    chats: [{ _id: "chat" }],
    chatParticipants: [{ _id: "participant", userId: "user", chatId: "chat" }],
    personas: [{ _id: "persona", userId: "user" }],
    runtimeDevices: [{ _id: "device_row", deviceId: "device", currentPresenceId: "presence" }],
    runtimeDevicePresences: [{ _id: "presence", adapters: [{ adapterId,
      capabilities: { adapterNative: { webSearch } } }] }],
    runtimeConversationBindings: [],
  };
  return createStatefulMockCtx(rows) as unknown as QueryCtx;
}

test("local dispatch reports the actual adapter's unavailable search without a backend trace", async () => {
  for (const adapterId of ["pi", "codex"]) {
    await assert.rejects(getLocalGenerationDispatchContextHandler(fixture(adapterId, false), {
      jobId: "job" as Id<"generationJobs">, webSearchEnabled: true,
    }), (error: unknown) => {
      const normalized = normalizeGenerationError(error);
      assert.equal(normalized.code, "RUNTIME_SEARCH_UNAVAILABLE");
      assert.equal(normalized.message, adapterId === "pi"
        ? "Basic search is not available for Pi. Turn off Basic search to use this Persona."
        : "Update NanthAI Runtime Host on this computer to use Basic search with Codex");
      return true;
    });
  }
});

test("search-off Pi and advertised native search preserve normal local dispatch", async () => {
  for (const [adapterId, advertised, enabled] of [["pi", false, false], ["codex", true, true]] as const) {
    const result = await getLocalGenerationDispatchContextHandler(fixture(adapterId, advertised), {
      jobId: "job" as Id<"generationJobs">, webSearchEnabled: enabled,
    });
    assert.equal(result?.placement, "local");
  }
});
