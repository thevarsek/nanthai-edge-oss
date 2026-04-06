import { cn } from "@/lib/utils";

interface ProBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

/**
 * A small pill that indicates a Pro feature or Pro account status.
 */
export function ProBadge({ size = "md", className }: ProBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold tracking-wide",
        "bg-surface-1 text-primary",
        "border border-primary/40",
        size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      Pro
    </span>
  );
}
