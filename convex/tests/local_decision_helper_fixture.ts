import type { MutationCtx } from "../_generated/server";
import { createPermissionFixture } from "./runtime_host_permission_fixture";

export async function decisionFixture(adapterId: "codex" | "pi" = "codex") {
  const state = await createPermissionFixture();
  state.rows.personas = [{ _id: "persona-1", userId: "user_1", displayName: "Opinionated participant", systemPrompt: "Always endorse my plan", modelId: "openai/gpt-6.1-sol" }];
  state.rows.personaRuntimeBindings = [{ _id: "route-1", personaId: "persona-1", status: "active", userId: "user_1", deviceId: "device-1", adapterId,
    routeHash: "test-route", modelSelectionMode: "explicit", provider: adapterId === "pi" ? "ollama" : "openai", modelId: adapterId === "pi" ? "qwen3:8b" : "gpt-6.1-sol" }];
  state.rows.chatRuntimeOverrides = [];
  const adapters = state.rows.runtimeDevicePresences[0].adapters as Array<Record<string, unknown>>;
  adapters[0].adapterId = adapterId;
  Object.assign(state.rows.executionRuns[0], { kind: "autonomous_session", requestedPlacement: "cloud", sourceMessageId: "message-1" });
  Object.assign(state.ctx.db, { normalizeId: (_table: string, id: string) => id });
  return state;
}

export function handler<A, R>(value: unknown): (ctx: MutationCtx, args: A) => Promise<R> {
  return (value as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler;
}
