export type PersonaRuntimeRoute = {
  deviceId: string;
  adapterId: string;
  modelSelectionMode: "adapter_default" | "explicit";
  provider?: string;
  modelId?: string;
};

export type PersonaRuntimeDevice = {
  deviceId: string;
  displayName: string;
  isOnline: boolean;
  adapters: Array<{
    adapterId: string;
    displayName?: string;
    isAvailable?: boolean;
    authState: string;
    operations: {
      listModels: boolean;
    };
  }>;
};

export function personaRuntimeRouteIsValid(route: PersonaRuntimeRoute | null): boolean {
  if (route === null) return true;
  if (!route.deviceId.trim() || !route.adapterId.trim()) return false;
  return route.modelSelectionMode !== "explicit" || !!route.modelId?.trim();
}

export function personaRuntimeRoutesEqual(
  left: PersonaRuntimeRoute | null,
  right: PersonaRuntimeRoute | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.deviceId === right.deviceId
    && left.adapterId === right.adapterId
    && left.modelSelectionMode === right.modelSelectionMode
    && (left.provider ?? null) === (right.provider ?? null)
    && (left.modelId ?? null) === (right.modelId ?? null);
}
