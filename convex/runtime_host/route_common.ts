import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { runtimeHostError, sha256Hex } from "./security";

export type RuntimeRouteInput = {
  deviceId: string;
  adapterId: string;
  modelSelectionMode: "adapter_default" | "explicit";
  provider?: string;
  modelId?: string;
};

export async function routeHash(route: RuntimeRouteInput): Promise<string> {
  return await sha256Hex(JSON.stringify({
    deviceId: route.deviceId,
    adapterId: route.adapterId,
    modelSelectionMode: route.modelSelectionMode,
    provider: route.provider ?? null,
    modelId: route.modelId ?? null,
  }));
}

export function validateModelSelection(route: RuntimeRouteInput): void {
  if (!route.deviceId.trim() || !route.adapterId.trim()) {
    throw runtimeHostError(
      "VALIDATION_ERROR",
      "A paired machine and adapter are required",
    );
  }
  if (route.modelSelectionMode === "explicit" && !route.modelId?.trim()) {
    throw runtimeHostError(
      "VALIDATION_ERROR",
      "An explicit local model selection requires a model",
    );
  }
  if (
    route.modelSelectionMode === "adapter_default"
    && (route.provider !== undefined || route.modelId !== undefined)
  ) {
    throw runtimeHostError(
      "VALIDATION_ERROR",
      "Adapter-default routing cannot include an explicit provider or model",
    );
  }
}

export async function assertRouteDevice(
  ctx: MutationCtx,
  userId: string,
  route: RuntimeRouteInput,
  now = Date.now(),
): Promise<{
  device: Doc<"runtimeDevices">;
  presence: Doc<"runtimeDevicePresences"> | null;
}> {
  validateModelSelection(route);
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", (query) => query.eq("deviceId", route.deviceId))
    .unique();
  if (!device || device.userId !== userId || device.status !== "active") {
    throw runtimeHostError("RUNTIME_UNAVAILABLE", "Selected paired machine is unavailable");
  }
  const presence = device.currentPresenceId
    ? await ctx.db.get(device.currentPresenceId)
    : null;
  if (route.modelSelectionMode === "explicit") {
    if (!presence || presence.status !== "online" || presence.expiresAt <= now) {
      throw runtimeHostError(
        "RUNTIME_RECONNECT_REQUIRED",
        "Reconnect the Runtime Host before assigning an explicit local model",
      );
    }
    const adapter = presence.adapters.find((candidate) =>
      candidate.adapterId === route.adapterId,
    );
    if (!adapter || adapter.authState !== "ready" || !adapter.capabilities.operations.listModels) {
      throw runtimeHostError(
        "RUNTIME_ADAPTER_UNAVAILABLE",
        "Selected adapter cannot currently verify explicit local models",
      );
    }
  }
  return { device, presence };
}
