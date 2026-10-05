import { z } from "zod";

export const RUNTIME_PROTOCOL_VERSION = "nanthai.runtime.v1" as const;
export const PROCESS_WIRE_VERSION = "nanthai.runtime.process.v1" as const;
export const PAIRING_PROTOCOL_VERSION = "nanthai.runtime.pairing.v1" as const;

export const RUNTIME_LIMITS = {
  idCharacters: 256,
  labelCharacters: 512,
  summaryCharacters: 2_000,
  detailCharacters: 4_000,
  instructionCharacters: 64_000,
  textPartCharacters: 256_000,
  deltaCharacters: 32_000,
  outputChunkCharacters: 64_000,
  maxMessages: 2_000,
  maxPartsPerMessage: 100,
  maxInstructions: 100,
  maxCapabilities: 500,
  maxArtifacts: 100,
  maxOmissions: 500,
  maxPermissionChoices: 20,
  maxModels: 2_000,
  maxStructuredInputCharacters: 64_000,
  maxStructuredInputEntries: 100,
  maxStructuredInputDepth: 8,
  maxChunkBytes: 4 * 1024 * 1024,
} as const;

export function boundedString(maximum: number) {
  return z.string().min(1).max(maximum);
}

export const IdentifierSchema = boundedString(RUNTIME_LIMITS.idCharacters);
export const LabelSchema = boundedString(RUNTIME_LIMITS.labelCharacters);
export const SummarySchema = boundedString(RUNTIME_LIMITS.summaryCharacters);
export const DetailSchema = boundedString(RUNTIME_LIMITS.detailCharacters);
export const TimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const FenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const MimeTypeSchema = z.string().min(3).max(200).regex(/^[^\s/]+\/[^\s]+$/);

export const AuthorizedFetchHandleSchema = z.strictObject({
  handle: boundedString(2_048),
  expiresAt: TimestampSchema,
  byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxChunkBytes: z.number().int().positive().max(RUNTIME_LIMITS.maxChunkBytes),
  sha256: Sha256Schema,
});

export type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };

const JsonScalarSchema: z.ZodType<RuntimeJsonValue> = z.union([
  z.string().max(RUNTIME_LIMITS.detailCharacters),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

function jsonValueSchema(depth: number): z.ZodType<RuntimeJsonValue> {
  if (depth === 0) return JsonScalarSchema;
  const nested = jsonValueSchema(depth - 1);
  return z.union([
    JsonScalarSchema,
    z.array(nested).max(RUNTIME_LIMITS.maxStructuredInputEntries),
    z.record(boundedString(256), nested).superRefine((value, context) => {
      if (Object.keys(value).length > RUNTIME_LIMITS.maxStructuredInputEntries) {
        context.addIssue({ code: "custom", message: "Structured input has too many keys" });
      }
    }),
  ]);
}

export const StructuredInputSchema = z.record(
  boundedString(256),
  jsonValueSchema(RUNTIME_LIMITS.maxStructuredInputDepth),
).superRefine((value, context) => {
  if (Object.keys(value).length > RUNTIME_LIMITS.maxStructuredInputEntries) {
    context.addIssue({ code: "custom", message: "Structured input has too many keys" });
  }
  if (JSON.stringify(value).length > RUNTIME_LIMITS.maxStructuredInputCharacters) {
    context.addIssue({ code: "custom", message: "Structured input exceeds wire bound" });
  }
});

export type AuthorizedFetchHandle = z.infer<typeof AuthorizedFetchHandleSchema>;
export type StructuredInput = z.infer<typeof StructuredInputSchema>;
