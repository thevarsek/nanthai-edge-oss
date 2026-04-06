import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * A centered empty-state placeholder used when a list or view has no content
 * to display.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center px-6 py-12",
        className,
      )}
    >
      {icon && (
        <div className="text-4xl text-muted mb-1">
          {icon}
        </div>
      )}

      <h3 className="text-sm font-medium text-secondary">
        {title}
      </h3>

      {description && (
        <p className="text-sm text-muted max-w-xs leading-relaxed">
          {description}
        </p>
      )}

      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
