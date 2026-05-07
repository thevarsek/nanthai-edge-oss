import { cn } from "@/lib/utils";

export type SemanticTone =
  | "pending"
  | "running"
  | "success"
  | "danger"
  | "warning"
  | "locked"
  | "info";

const toneTextClasses: Record<SemanticTone, string> = {
  pending: "text-muted",
  running: "text-primary",
  success: "text-success",
  danger: "text-destructive",
  warning: "text-warning",
  locked: "text-muted",
  info: "text-info",
};

const toneBgClasses: Record<SemanticTone, string> = {
  pending: "bg-surface-3/50",
  running: "bg-primary/15",
  success: "bg-success/15",
  danger: "bg-destructive/15",
  warning: "bg-warning/15",
  locked: "bg-surface-3/60",
  info: "bg-info/15",
};

const toneBorderClasses: Record<SemanticTone, string> = {
  pending: "border-border/20",
  running: "border-primary/25",
  success: "border-success/25",
  danger: "border-destructive/25",
  warning: "border-warning/25",
  locked: "border-border/30",
  info: "border-info/25",
};

const toneDotClasses: Record<SemanticTone, string> = {
  pending: "bg-muted",
  running: "bg-primary",
  success: "bg-success",
  danger: "bg-destructive",
  warning: "bg-warning",
  locked: "bg-foreground/30",
  info: "bg-info",
};

export function toneForStatus(status: string | undefined | null): SemanticTone {
  switch ((status ?? "").toLowerCase()) {
    case "active":
    case "completed":
    case "complete":
    case "success":
    case "accepted":
      return "success";
    case "pending":
    case "queued":
      return "pending";
    case "running":
    case "streaming":
    case "in_progress":
    case "submitted":
    case "polling":
    case "running_children":
    case "resuming":
    case "searching":
    case "analyzing":
    case "deepening":
    case "synthesizing":
    case "writing":
      return "running";
    case "failed":
    case "failure":
    case "error":
    case "rejected":
    case "destructive":
    case "timedout":
    case "timed_out":
      return "danger";
    case "cancelled":
    case "canceled":
    case "paused":
    case "warning":
      return "warning";
    case "locked":
    case "unavailable":
    case "pro":
    case "disabled":
      return "locked";
    case "planning":
    case "waiting_to_resume":
      return "info";
    default:
      return "locked";
  }
}

export function toneTextClass(tone: SemanticTone): string {
  return toneTextClasses[tone];
}

export function toneBgClass(tone: SemanticTone): string {
  return toneBgClasses[tone];
}

export function toneBorderClass(tone: SemanticTone): string {
  return toneBorderClasses[tone];
}

export function statusTextClass(status: string | undefined | null): string {
  return toneTextClass(toneForStatus(status));
}

export function statusDotClass(status: string | undefined | null): string {
  return toneDotClasses[toneForStatus(status)];
}

export function statusBadgeClass(
  status: string | undefined | null,
  className?: string,
): string {
  const tone = toneForStatus(status);
  return cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
    toneTextClasses[tone],
    toneBgClasses[tone],
    toneBorderClasses[tone],
    className,
  );
}

export function tonePanelClass(tone: SemanticTone, className?: string): string {
  return cn(
    "rounded-xl border",
    toneTextClasses[tone],
    toneBgClasses[tone],
    toneBorderClasses[tone],
    className,
  );
}

export function workspaceSurfaceClass(className?: string): string {
  return cn(
    "rounded-xl border border-border/25 bg-surface-2/55",
    className,
  );
}

export function workspaceIconBlockClass(className?: string): string {
  return cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary",
    className,
  );
}
