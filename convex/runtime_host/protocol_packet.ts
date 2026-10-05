import { z } from "zod";
import {
  AuthorizedFetchHandleSchema,
  boundedString,
  FenceSchema,
  IdentifierSchema,
  LabelSchema,
  MimeTypeSchema,
  RUNTIME_LIMITS,
  RUNTIME_PROTOCOL_VERSION,
  Sha256Schema,
  SummarySchema,
} from "./protocol_common";
import { RuntimePlacementSchema } from "./protocol_placement";

export const RuntimeInputModalitySchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "file",
  "tool_evidence",
]);

const fetchedPartFields = {
  partId: IdentifierSchema,
  name: LabelSchema.nullable(),
  fetch: AuthorizedFetchHandleSchema,
};

export const RuntimeContentPartSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    partId: IdentifierSchema,
    text: boundedString(RUNTIME_LIMITS.textPartCharacters),
  }),
  z.strictObject({
    type: z.literal("image"),
    ...fetchedPartFields,
    mimeType: MimeTypeSchema,
    altText: SummarySchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("audio"),
    ...fetchedPartFields,
    mimeType: MimeTypeSchema,
    transcript: boundedString(RUNTIME_LIMITS.instructionCharacters).nullable(),
  }),
  z.strictObject({
    type: z.literal("video"),
    ...fetchedPartFields,
    mimeType: MimeTypeSchema,
    transcript: boundedString(RUNTIME_LIMITS.instructionCharacters).nullable(),
  }),
  z.strictObject({
    type: z.literal("document"),
    ...fetchedPartFields,
    mimeType: MimeTypeSchema,
    extractedText: boundedString(RUNTIME_LIMITS.textPartCharacters).nullable(),
  }),
  z.strictObject({
    type: z.literal("file"),
    ...fetchedPartFields,
    mimeType: MimeTypeSchema,
  }),
  z.strictObject({
    type: z.literal("tool_evidence"),
    ...fetchedPartFields,
    mimeType: MimeTypeSchema,
    toolName: IdentifierSchema,
    summary: SummarySchema,
  }),
]);

export const RuntimeMessageSchema = z.strictObject({
  ordinal: z.number().int().nonnegative().max(RUNTIME_LIMITS.maxMessages - 1),
  messageId: IdentifierSchema,
  role: z.enum(["system", "user", "assistant", "tool"]),
  name: LabelSchema.nullable(),
  participantId: IdentifierSchema.nullable(),
  content: z.array(RuntimeContentPartSchema)
    .min(1)
    .max(RUNTIME_LIMITS.maxPartsPerMessage),
});

const InstructionSchema = z.strictObject({
  instructionId: IdentifierSchema,
  name: LabelSchema,
  text: boundedString(RUNTIME_LIMITS.instructionCharacters),
  sourceHash: Sha256Schema,
});

const CapabilityReferenceSchema = z.strictObject({
  id: IdentifierSchema,
  name: LabelSchema,
  version: IdentifierSchema.nullable(),
});

const RuntimeToolSchema = CapabilityReferenceSchema.extend({
  effect: z.enum(["read", "write", "destructive"]),
  inputSchemaHash: Sha256Schema,
});

const ContextReferenceSchema = z.strictObject({
  id: IdentifierSchema,
  kind: z.enum(["artifact", "memory", "graph_node", "tool_result"]),
  version: IdentifierSchema.nullable(),
});

const ContextOmissionSchema = z.strictObject({
  sourceId: IdentifierSchema.nullable(),
  kind: z.enum(["budget", "policy", "unsupported", "unavailable", "deduplicated"]),
  omittedPartCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: SummarySchema,
});

const LiveDiscussionCausalitySchema = z.strictObject({
  discussionId: IdentifierSchema,
  waveId: IdentifierSchema,
  waveNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sameWaveParticipantIds: z.array(IdentifierSchema)
    .max(RUNTIME_LIMITS.maxCapabilities),
});

export const RuntimeTurnPacketSchema = z.strictObject({
  protocolVersion: z.literal(RUNTIME_PROTOCOL_VERSION),
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  fence: FenceSchema,
  chatId: IdentifierSchema,
  sourceMessageId: IdentifierSchema,
  participantId: IdentifierSchema,
  personaId: IdentifierSchema.nullable(),
  messages: z.array(RuntimeMessageSchema).min(1).max(RUNTIME_LIMITS.maxMessages),
  instructions: z.strictObject({
    system: z.array(InstructionSchema).max(RUNTIME_LIMITS.maxInstructions),
    persona: z.array(InstructionSchema).max(RUNTIME_LIMITS.maxInstructions),
  }),
  context: z.strictObject({
    evidenceSources: z.array(z.object({ id: z.string(), kind: z.enum(["message", "memory", "document", "native_file"]), label: z.string(), text: z.string() })).optional(),
    assemblerVersion: IdentifierSchema,
    canonicalHeadMessageId: IdentifierSchema,
    references: z.array(ContextReferenceSchema).max(RUNTIME_LIMITS.maxCapabilities),
    omissions: z.array(ContextOmissionSchema).max(RUNTIME_LIMITS.maxOmissions),
    omittedPartCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  capabilities: z.strictObject({
    nanthaiTools: z.array(RuntimeToolSchema).max(RUNTIME_LIMITS.maxCapabilities),
    skills: z.array(CapabilityReferenceSchema).max(RUNTIME_LIMITS.maxCapabilities),
    integrations: z.array(CapabilityReferenceSchema).max(RUNTIME_LIMITS.maxCapabilities),
    adapterNativePolicy: z.literal("preserve"),
    webSearch: z.literal("live").optional(),
  }),
  placement: RuntimePlacementSchema,
  causality: z.strictObject({
    replyToMessageIds: z.array(IdentifierSchema).max(RUNTIME_LIMITS.maxMessages),
    visibleThroughMessageId: IdentifierSchema,
    liveDiscussion: LiveDiscussionCausalitySchema.nullable(),
  }),
  command: z.strictObject({
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    commandInputHash: z.string().regex(/^[a-f0-9]{8}$/),
    packetHash: Sha256Schema,
    cancellationId: IdentifierSchema,
  }),
}).superRefine((packet, context) => {
  const placementMatches = packet.runId === packet.placement.runId
    && packet.attemptId === packet.placement.attemptId
    && packet.fence === packet.placement.fence;
  if (!placementMatches) {
    context.addIssue({
      code: "custom",
      path: ["placement"],
      message: "Placement must carry the packet run, attempt, and fence",
    });
  }
  if (packet.placement.placement === "local" && packet.personaId === null) {
    context.addIssue({
      code: "custom",
      path: ["personaId"],
      message: "Local runtime placement requires a Persona participant",
    });
  }
  packet.messages.forEach((message, index) => {
    if (message.ordinal !== index) {
      context.addIssue({
        code: "custom",
        path: ["messages", index, "ordinal"],
        message: "Message ordinals must be contiguous and preserve array order",
      });
    }
  });
  const messageIds = new Set<string>();
  const partIds = new Set<string>();
  packet.messages.forEach((message, messageIndex) => {
    if (messageIds.has(message.messageId)) {
      context.addIssue({
        code: "custom",
        path: ["messages", messageIndex, "messageId"],
        message: "messageId must be unique within the packet",
      });
    }
    messageIds.add(message.messageId);
    message.content.forEach((part, partIndex) => {
      if (partIds.has(part.partId)) {
        context.addIssue({
          code: "custom",
          path: ["messages", messageIndex, "content", partIndex, "partId"],
          message: "partId must be unique within the packet",
        });
      }
      partIds.add(part.partId);
    });
  });
  const requiredMessageReferences = [
    packet.sourceMessageId,
    packet.context.canonicalHeadMessageId,
    packet.causality.visibleThroughMessageId,
  ];
  if (requiredMessageReferences.some((messageId) => !messageIds.has(messageId))) {
    context.addIssue({
      code: "custom",
      path: ["messages"],
      message: "Packet must contain its source, canonical head, and visible frontier",
    });
  }
  const omittedParts = packet.context.omissions.reduce(
    (total, omission) => total + omission.omittedPartCount,
    0,
  );
  if (omittedParts !== packet.context.omittedPartCount) {
    context.addIssue({
      code: "custom",
      path: ["context", "omittedPartCount"],
      message: "omittedPartCount must equal the explicit omission ledger",
    });
  }
});

export type RuntimeInputModality = z.infer<typeof RuntimeInputModalitySchema>;
export type RuntimeContentPart = z.infer<typeof RuntimeContentPartSchema>;
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;
export type RuntimeTurnPacket = z.infer<typeof RuntimeTurnPacketSchema>;

export const LocalRuntimeTurnPacketSchema = RuntimeTurnPacketSchema.refine(
  (packet) => packet.placement.placement === "local",
  { path: ["placement"], message: "Runtime Host process messages require local placement" },
);

export type LocalRuntimeTurnPacket = RuntimeTurnPacket & {
  personaId: string;
  placement: Extract<RuntimeTurnPacket["placement"], { placement: "local" }>;
};
