import { z } from "zod";
import {
  FenceSchema,
  IdentifierSchema,
  LabelSchema,
  RUNTIME_PROTOCOL_VERSION,
} from "./protocol_common";

export const RuntimeModelSelectionSchema = z.strictObject({
  mode: z.enum(["adapter_default", "explicit"]),
  provider: IdentifierSchema.nullable(),
  modelId: IdentifierSchema.nullable(),
}).superRefine((selection, context) => {
  if (selection.mode === "explicit" && selection.modelId === null) {
    context.addIssue({
      code: "custom",
      path: ["modelId"],
      message: "An explicit model selection requires modelId",
    });
  }
  if (selection.mode === "adapter_default"
    && (selection.provider !== null || selection.modelId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["mode"],
      message: "Adapter-default placement cannot carry an explicit provider or model",
    });
  }
});

const placementBase = {
  protocolVersion: z.literal(RUNTIME_PROTOCOL_VERSION),
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  fence: FenceSchema,
  adapter: z.strictObject({
    adapterId: IdentifierSchema,
    adapterVersion: IdentifierSchema.nullable(),
  }),
  selectedModel: RuntimeModelSelectionSchema,
};

export const LocalRuntimePlacementSchema = z.strictObject({
  ...placementBase,
  placement: z.literal("local"),
  executorKind: z.literal("local_runtime"),
  orchestrationEngine: z.literal("runtime_adapter"),
  device: z.strictObject({
    deviceId: IdentifierSchema,
    displayName: LabelSchema,
  }),
  workingDirectory: z.strictObject({
    mode: z.literal("discover_at_session_start"),
  }),
});

export const CloudRuntimePlacementSchema = z.strictObject({
  ...placementBase,
  placement: z.literal("cloud"),
  executorKind: z.enum(["convex_action", "convex_workflow", "external_cloud"]),
  orchestrationEngine: z.enum(["convex_workflow", "convex_workpool", "runtime_adapter"]),
  device: z.null(),
  workingDirectory: z.strictObject({
    mode: z.literal("not_applicable"),
  }),
});

export const RuntimePlacementSchema = z.discriminatedUnion("placement", [
  CloudRuntimePlacementSchema,
  LocalRuntimePlacementSchema,
]);

export type RuntimeModelSelection = z.infer<typeof RuntimeModelSelectionSchema>;
export type LocalRuntimePlacement = z.infer<typeof LocalRuntimePlacementSchema>;
export type CloudRuntimePlacement = z.infer<typeof CloudRuntimePlacementSchema>;
export type RuntimePlacement = z.infer<typeof RuntimePlacementSchema>;
