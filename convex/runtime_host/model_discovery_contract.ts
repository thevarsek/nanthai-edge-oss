import { type Infer, v } from "convex/values";

export const runtimeModelDiscoveryStatus = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("expired"),
);

export const runtimeModelDescriptorInput = v.object({
  provider: v.union(v.string(), v.null()),
  modelId: v.string(),
  displayName: v.string(),
  availability: v.union(v.literal("available"), v.literal("unavailable")),
  unavailableReason: v.union(v.string(), v.null()),
  inputModalities: v.array(v.string()),
  supportsTools: v.boolean(),
  supportsReasoning: v.boolean(),
});

export type RuntimeModelDescriptorInput = Infer<typeof runtimeModelDescriptorInput>;

export const runtimeModelDescriptorResult = runtimeModelDescriptorInput;

