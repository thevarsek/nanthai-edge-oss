import * as bridgeImport from "../../convex/runtime_host/bridge_contract.ts";
import * as protocolImport from "../../convex/runtime_host/protocol_v1.ts";
import type {
  AdapterCapabilities,
  AdapterEvent,
  AdapterModelDescriptor,
  HostToWorkerMessage,
  LocalRuntimeTurnPacket,
  PermissionDecision,
  ProcessWireMessage,
  RuntimeContentPart,
  RuntimeInputModality,
  RuntimeTurnPacket,
  StructuredInput,
  WorkerToHostMessage,
} from "../../convex/runtime_host/protocol_v1.ts";

const protocol = cjsCompatible(protocolImport);
export const { BRIDGE_TOOLS, BridgeRequestSchema, PublishResultSchema, WorkResultSchema } = cjsCompatible(bridgeImport);

export const {
  AdapterCapabilitiesSchema,
  AdapterModelDescriptorSchema,
  AdapterEventSchema,
  HostToWorkerMessageSchema,
  LocalRuntimeTurnPacketSchema,
  PermissionDecisionSchema,
  ProcessWireMessageSchema,
  RuntimeTurnPacketSchema,
  StructuredInputSchema,
  WorkerToHostMessageSchema,
  PROCESS_WIRE_VERSION,
  RUNTIME_LIMITS,
  RUNTIME_PROTOCOL_VERSION,
} = protocol;

export type {
  AdapterCapabilities,
  AdapterModelDescriptor,
  AdapterEvent,
  HostToWorkerMessage,
  LocalRuntimeTurnPacket,
  PermissionDecision,
  ProcessWireMessage,
  RuntimeContentPart,
  RuntimeInputModality,
  RuntimeTurnPacket,
  StructuredInput,
  WorkerToHostMessage,
};

function cjsCompatible<T extends object>(module: T): T {
  if (!("default" in module)) return module;
  return (module as T & { default: T }).default;
}
