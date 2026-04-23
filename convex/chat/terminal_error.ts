export type TerminalErrorCode =
  | "stream_timeout"
  | "provider_error"
  | "cancelled_by_retry"
  | "cancelled_by_user"
  | "unknown_error";

export function classifyTerminalErrorCode(args: {
  status: "completed" | "failed" | "cancelled";
  error?: string;
  existingCode?: TerminalErrorCode;
}): TerminalErrorCode | undefined {
  if (args.status === "completed") {
    return undefined;
  }

  if (args.existingCode) {
    return args.existingCode;
  }

  const message = args.error?.toLowerCase() ?? "";
  if (args.status === "cancelled") {
    return "cancelled_by_user";
  }
  if (message.includes("timeout")) {
    return "stream_timeout";
  }
  if (message.includes("openrouter") || message.includes("provider")) {
    return "provider_error";
  }
  return "unknown_error";
}
