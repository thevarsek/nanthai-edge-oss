import type { Recurrence } from "./recurrence";

export type ScheduledJobInvocationSource = "scheduled" | "manual";

export function shouldExecuteScheduledJob(args: {
  status: string;
  recurrence: Recurrence;
  invocationSource: ScheduledJobInvocationSource;
}): boolean {
  if (args.status === "active") {
    return true;
  }

  return args.invocationSource === "manual"
    && args.status === "paused"
    && args.recurrence.type !== "manual";
}

export function shouldReplaceExistingSchedule(args: {
  status: string;
  invocationSource: ScheduledJobInvocationSource;
}): boolean {
  return args.status === "active" && args.invocationSource === "manual";
}
