import { BridgeRequestSchema } from "./bridge_contract";
import { z } from "zod";
import {
  AdapterCapabilitiesSchema,
  AdapterModelDescriptorSchema,
  NonTerminalAdapterEventSchema,
  PermissionDecisionSchema,
  TerminalAdapterEventSchema,
} from "./protocol_adapter";
import {
  boundedString,
  IdentifierSchema,
  PROCESS_WIRE_VERSION,
  RUNTIME_LIMITS,
  SequenceSchema,
  Sha256Schema,
  StructuredInputSchema,
  SummarySchema,
  TimestampSchema,
} from "./protocol_common";
import {
  LocalRuntimeTurnPacketSchema,
} from "./protocol_packet";
import { LocalRuntimePlacementSchema } from "./protocol_placement";

const wireBase = {
  wireVersion: z.literal(PROCESS_WIRE_VERSION),
  messageId: IdentifierSchema,
  sequence: SequenceSchema,
  sentAt: TimestampSchema,
};

const ProbeRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("probe_request"),
  payload: z.strictObject({}),
});

const ListModelsRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("list_models_request"),
  payload: z.strictObject({}),
});

const StartSessionRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("start_session_request"),
  payload: z.strictObject({
    placement: LocalRuntimePlacementSchema,
    packetSeed: LocalRuntimeTurnPacketSchema,
  }),
}).superRefine((message, context) => {
  if (JSON.stringify(message.payload.placement)
    !== JSON.stringify(message.payload.packetSeed.placement)) {
    context.addIssue({
      code: "custom",
      path: ["payload", "placement"],
      message: "Session placement must exactly match the canonical packet seed",
    });
  }
});

const SendTurnRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("send_turn_request"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    commandId: IdentifierSchema,
    packetHash: Sha256Schema,
  }),
});

const CancelRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("cancel_request"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    cancellationId: IdentifierSchema,
    reason: SummarySchema,
  }),
});

const PermissionResponseRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("permission_response_request"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    permissionRequestId: IdentifierSchema,
    decision: PermissionDecisionSchema,
  }),
});

const InputResponseRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("input_response_request"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    inputRequestId: IdentifierSchema,
    response: z.discriminatedUnion("outcome", [
      z.strictObject({
        outcome: z.literal("submitted"),
        content: StructuredInputSchema,
      }),
      z.strictObject({
        outcome: z.literal("cancelled"),
        content: z.null(),
      }),
    ]),
  }),
});

const ResumeRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("resume_request"),
  payload: z.strictObject({
    placement: LocalRuntimePlacementSchema,
    packetSeed: LocalRuntimeTurnPacketSchema,
    nativeSessionId: IdentifierSchema,
    checkpointRef: IdentifierSchema.nullable(),
    expectedNativeTurnId: IdentifierSchema.optional(),
    deliveredMessageIds: z.array(IdentifierSchema).max(512).optional(),
  }),
}).superRefine((message, context) => {
  if (JSON.stringify(message.payload.placement)
    !== JSON.stringify(message.payload.packetSeed.placement)) {
    context.addIssue({
      code: "custom",
      path: ["payload", "placement"],
      message: "Resume placement must exactly match the canonical packet seed",
    });
  }
});

const CloseRequestSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("close_request"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    reason: SummarySchema,
  }),
});

const WorkerReadySchema = z.strictObject({
  ...wireBase,
  kind: z.literal("worker_ready"),
  payload: z.strictObject({
    workerId: IdentifierSchema,
    processId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    capabilities: AdapterCapabilitiesSchema,
  }),
});

const ProbeResultSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("probe_result"),
  payload: z.strictObject({
    requestMessageId: IdentifierSchema,
    healthy: z.boolean(),
    authState: z.enum(["ready", "signed_out", "unavailable"]),
    summary: SummarySchema,
  }),
});

const ModelsResultSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("models_result"),
  payload: z.strictObject({
    requestMessageId: IdentifierSchema,
    models: z.array(AdapterModelDescriptorSchema).max(RUNTIME_LIMITS.maxModels),
  }),
});

const SessionResultSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("session_result"),
  payload: z.strictObject({
    requestMessageId: IdentifierSchema,
    sessionId: IdentifierSchema,
    nativeSessionId: IdentifierSchema.nullable(),
    resumed: z.boolean(),
    replacementReason: z.enum(["native_frontier_changed"]).optional(),
  }),
});

const CommandResultSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("command_result"),
  payload: z.strictObject({
    requestMessageId: IdentifierSchema,
    status: z.enum(["accepted", "completed", "rejected"]),
    code: IdentifierSchema.nullable(),
    summary: SummarySchema,
  }),
});

const AdapterEventMessageSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("adapter_event"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    event: NonTerminalAdapterEventSchema,
  }),
}).superRefine((message, context) => {
  if (message.payload.sessionId !== message.payload.event.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["payload", "sessionId"],
      message: "Event envelope and adapter event sessionId must match",
    });
  }
});

const TerminalEventMessageSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("terminal_event"),
  payload: z.strictObject({
    sessionId: IdentifierSchema,
    event: TerminalAdapterEventSchema,
  }),
}).superRefine((message, context) => {
  if (message.payload.sessionId !== message.payload.event.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["payload", "sessionId"],
      message: "Terminal envelope and adapter event sessionId must match",
    });
  }
});

const ProtocolErrorMessageSchema = z.strictObject({
  ...wireBase,
  kind: z.literal("protocol_error"),
  payload: z.strictObject({
    requestMessageId: IdentifierSchema.nullable(),
    code: IdentifierSchema,
    message: boundedString(4_000),
    recoverable: z.boolean(),
  }),
});

const BridgeResponseSchema = z.strictObject({
  ...wireBase, kind: z.literal("bridge_response"),
  payload: z.strictObject({ callId: IdentifierSchema, success: z.boolean(), text: boundedString(32_000) }),
});
const BridgeCallSchema = z.strictObject({
  ...wireBase, kind: z.literal("bridge_call"), payload: BridgeRequestSchema,
});

export const HostToWorkerMessageSchema = z.discriminatedUnion("kind", [
  BridgeResponseSchema,
  ProbeRequestSchema,
  ListModelsRequestSchema,
  StartSessionRequestSchema,
  SendTurnRequestSchema,
  CancelRequestSchema,
  PermissionResponseRequestSchema,
  InputResponseRequestSchema,
  ResumeRequestSchema,
  CloseRequestSchema,
]);

export const WorkerToHostMessageSchema = z.discriminatedUnion("kind", [
  BridgeCallSchema,
  WorkerReadySchema,
  ProbeResultSchema,
  ModelsResultSchema,
  SessionResultSchema,
  CommandResultSchema,
  AdapterEventMessageSchema,
  TerminalEventMessageSchema,
  ProtocolErrorMessageSchema,
]);

export const ProcessWireMessageSchema = z.union([
  HostToWorkerMessageSchema,
  WorkerToHostMessageSchema,
]);

export type HostToWorkerMessage = z.infer<typeof HostToWorkerMessageSchema>;
export type WorkerToHostMessage = z.infer<typeof WorkerToHostMessageSchema>;
export type ProcessWireMessage = z.infer<typeof ProcessWireMessageSchema>;
