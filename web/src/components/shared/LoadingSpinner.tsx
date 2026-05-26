import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
}

export function LoadingSpinner({
  size = "md",
  className,
  label = "Loading",
}: LoadingSpinnerProps) {
  const sizeClass = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-10 h-10 border-[3px]",
  }[size];

  return (
    <div
      className={cn(
        "rounded-full border-transparent border-t-primary animate-spin motion-reduce:h-auto motion-reduce:w-auto motion-reduce:rounded-none motion-reduce:border-0 motion-reduce:animate-none motion-reduce:border-transparent",
        sizeClass,
        className,
      )}
      role="status"
      aria-label={label}
    >
      {/* Visible text fallback when prefers-reduced-motion is on */}
      <span className="sr-only motion-reduce:not-sr-only motion-reduce:whitespace-nowrap motion-reduce:text-xs motion-reduce:text-muted">
        {label}...
      </span>
    </div>
  );
}
