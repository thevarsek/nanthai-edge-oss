import { v } from "convex/values";

export const runtimePermissionDecision = v.union(
  v.literal("allow_once"),
  v.literal("allow_session"),
  v.literal("deny"),
  v.literal("cancel"),
);

export const runtimePermissionStatus = v.union(
  v.literal("pending"),
  v.literal("responding"),
  v.literal("resolved"),
  v.literal("expired"),
  v.literal("closed"),
);

export const runtimePermissionUnavailableReason = v.union(
  v.literal("response_pending"),
  v.literal("request_expired"),
  v.literal("execution_unavailable"),
  v.literal("runtime_host_offline"),
  v.literal("runtime_adapter_unavailable"),
  v.literal("runtime_session_unavailable"),
);

export type RuntimePermissionDecision =
  | "allow_once"
  | "allow_session"
  | "deny"
  | "cancel";

export type RuntimePermissionUnavailableReason =
  | "response_pending"
  | "request_expired"
  | "execution_unavailable"
  | "runtime_host_offline"
  | "runtime_adapter_unavailable"
  | "runtime_session_unavailable";
