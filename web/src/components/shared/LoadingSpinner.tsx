import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  const sizeClass = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-10 h-10 border-3",
  }[size];

  return (
    <div
      className={cn(
        "rounded-full border-transparent border-t-primary animate-spin",
        sizeClass,
        className,
      )}
      style={{ borderWidth: size === "lg" ? 3 : 2 }}
      role="status"
      aria-label="Loading"
    />
  );
}
