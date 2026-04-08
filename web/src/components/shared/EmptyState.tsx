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
 *
 * Visual hierarchy: large dimmed icon → medium-weight title → smaller muted
 * description → optional CTA.  Entrance animation via `animate-fade-in`.
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
        "flex flex-col items-center justify-center gap-2 text-center px-6 py-12 animate-fade-in",
        className,
      )}
    >
      {icon && (
        <div className="text-4xl text-foreground/25 mb-2">
          {icon}
        </div>
      )}

      <h3 className="text-base font-semibold text-foreground/70">
        {title}
      </h3>

      {description && (
        <p className="text-sm text-foreground/40 max-w-xs leading-relaxed">
          {description}
        </p>
      )}

      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
