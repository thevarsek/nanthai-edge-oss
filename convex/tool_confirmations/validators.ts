import { v } from "convex/values";

export const toolConfirmationKind = v.union(
  v.literal("external_send"),
  v.literal("scheduled_job"),
  v.literal("skill_change"),
);

export const toolConfirmationStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("expired"),
  v.literal("closed"),
);

export const toolConfirmationDecision = v.union(v.literal("approve"), v.literal("deny"));

/** Client-facing pending confirmation, attached to the owning run projection. */
export const pendingToolConfirmation = v.object({
  confirmationId: v.string(),
  kind: toolConfirmationKind,
  toolName: v.string(),
  summary: v.string(),
  detail: v.optional(v.string()),
  recipients: v.array(v.string()),
  integrations: v.array(v.string()),
  expiresAt: v.number(),
  createdAt: v.number(),
});

export type ToolConfirmationDecision = "approve" | "deny";
export type ToolConfirmationStatus = "pending" | "approved" | "denied" | "expired" | "closed";

export interface PendingToolConfirmation {
  confirmationId: string;
  kind: "external_send" | "scheduled_job" | "skill_change";
  toolName: string;
  summary: string;
  detail?: string;
  recipients: string[];
  integrations: string[];
  expiresAt: number;
  createdAt: number;
}
