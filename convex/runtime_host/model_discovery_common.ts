import type { Doc } from "../_generated/dataModel";
import { IdentifierSchema } from "./protocol_common";
import { runtimeHostError } from "./security";

export type DiscoveryAdapter = Doc<"runtimeDevicePresences">["adapters"][number];

export function eligibleModelDiscoveryAdapter(
  presence: Doc<"runtimeDevicePresences">,
  adapterId: string,
  expectedVersion?: string,
): DiscoveryAdapter | null {
  const adapter = presence.adapters.find((candidate) =>
    candidate.adapterId === adapterId
  );
  if (
    !adapter
    || adapter.authState !== "ready"
    || !adapter.capabilities.operations.listModels
    || (expectedVersion !== undefined && adapter.adapterVersion !== expectedVersion)
  ) return null;
  return adapter;
}

export function assertModelDiscoveryAdapter(
  presence: Doc<"runtimeDevicePresences">,
  adapterId: string,
  expectedVersion?: string,
): DiscoveryAdapter {
  if (!IdentifierSchema.safeParse(adapterId).success) {
    throw runtimeHostError("VALIDATION_ERROR", "Runtime adapter ID is invalid");
  }
  const adapter = eligibleModelDiscoveryAdapter(
    presence,
    adapterId,
    expectedVersion,
  );
  if (!adapter) {
    throw runtimeHostError(
      "RUNTIME_ADAPTER_UNAVAILABLE",
      "Selected adapter cannot currently list its available models",
    );
  }
  return adapter;
}

