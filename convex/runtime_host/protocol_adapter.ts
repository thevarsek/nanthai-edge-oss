import { z } from "zod";
import {
  IdentifierSchema,
  LabelSchema,
  RUNTIME_PROTOCOL_VERSION,
  SummarySchema,
} from "./protocol_common";
import { RuntimeInputModalitySchema } from "./protocol_packet";
import { AdapterEventTypeSchema } from "./protocol_adapter_events";

export const AdapterModelDescriptorSchema = z.strictObject({
  provider: IdentifierSchema.nullable(),
  modelId: IdentifierSchema,
  displayName: LabelSchema,
  availability: z.enum(["available", "unavailable"]),
  unavailableReason: SummarySchema.nullable(),
  inputModalities: z.array(RuntimeInputModalitySchema)
    .min(1)
    .max(RuntimeInputModalitySchema.options.length),
  supportsTools: z.boolean(),
  supportsReasoning: z.boolean(),
});

export const AdapterCapabilitiesSchema = z.strictObject({
  protocolVersion: z.literal(RUNTIME_PROTOCOL_VERSION),
  adapterId: IdentifierSchema,
  adapterVersion: IdentifierSchema,
  transport: z.enum(["sdk", "stdio_jsonrpc", "stdio_jsonl", "acp"]),
  inputModalities: z.array(RuntimeInputModalitySchema)
    .min(1)
    .max(RuntimeInputModalitySchema.options.length),
  eventTypes: z.array(AdapterEventTypeSchema)
    .min(1)
    .max(AdapterEventTypeSchema.options.length),
  operations: z.strictObject({
    listModels: z.boolean(),
    cancel: z.boolean(),
    resume: z.boolean(),
    permissionResponse: z.boolean(),
    inputResponse: z.boolean(),
  }),
  nanthaiCollaborationWork: z.boolean().optional(),
  nanthaiSourceCitations: z.boolean().optional(),
  adapterNative: z.strictObject({
    tools: z.boolean(),
    plugins: z.boolean(),
    mcpServers: z.boolean(),
    skills: z.boolean(),
    webSearch: z.boolean().optional(),
  }),
});

export type AdapterModelDescriptor = z.infer<typeof AdapterModelDescriptorSchema>;
export type AdapterCapabilities = z.infer<typeof AdapterCapabilitiesSchema>;

export {
  ActualModelSchema,
  AdapterEventSchema,
  AdapterEventTypeSchema,
  NonTerminalAdapterEventSchema,
  PermissionDecisionSchema,
  TerminalAdapterEventSchema,
} from "./protocol_adapter_events";
export type {
  ActualModel,
  AdapterEvent,
  NonTerminalAdapterEvent,
  PermissionDecision,
  TerminalAdapterEvent,
} from "./protocol_adapter_events";
