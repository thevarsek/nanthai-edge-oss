import { z } from "zod";
import { v } from "convex/values";
import { PublishResultSchema } from "./bridge_contract";

export const OfflineImportSchema = z.strictObject({
  id: z.string().uuid(), originRunId: z.string().min(1), previousResultId: z.string().uuid().nullable(),
  baseOutputHash: z.string().regex(/^[a-f0-9]{64}$/), prompt: z.string().min(1), output: z.string(),
  outcome: z.enum(["completed", "failed", "interrupted", "cancelled"]), createdAt: z.number().nonnegative(),
  sourceCitations: z.array(z.object({ sourceId: z.string(), kind: z.string(), label: z.string(), quote: z.string(), claim: z.string().optional() })).default([]),
  files: z.array(PublishResultSchema), usage: z.array(z.unknown()),
});
export const offlineResultValidator = v.object({
  localResultId: v.string(), originRunId: v.id("executionRuns"),
  disposition: v.union(v.literal("synced"), v.literal("review")),
});
export const offlineImportFileValidator = v.object({
  storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), sizeBytes: v.number(),
});
