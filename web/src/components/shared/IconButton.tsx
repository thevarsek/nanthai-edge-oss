import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ── Variants ────────────────────────────────────────────────────────

type IconButtonVariant = "ghost" | "subtle" | "filled" | "danger";
type IconButtonSize = "xs" | "sm" | "md" | "lg";

const variantClasses: Record<IconButtonVariant, string> = {
  ghost:
    "text-muted hover:text-foreground hover:bg-foreground/8 active:bg-foreground/12",
  subtle:
    "text-foreground/60 hover:text-foreground hover:bg-surface-3 active:bg-surface-3/80",
  filled:
    "bg-primary text-white hover:bg-primary/90 active:bg-primary/80",
  danger:
    "text-muted hover:text-destructive hover:bg-destructive/10 active:bg-destructive/15",
};

const sizeClasses: Record<IconButtonSize, string> = {
  xs: "h-8 w-8 rounded-lg",
  sm: "h-10 w-10 rounded-xl",
  md: "h-10 w-10 rounded-xl",
  lg: "h-10 w-10 rounded-xl",
};

// ── Component ───────────────────────────────────────────────────────

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Accessible label (required when children is only an icon). */
  label: string;
  children: ReactNode;
}

/**
 * Shared icon button with standardized interactive states.
 *
 * Includes hover, active (pressed), focus-visible, and disabled styling.
 * Always renders an `aria-label` for accessibility.
 *
 * ```tsx
 * <IconButton label="Copy" variant="ghost" size="sm" onClick={handleCopy}>
 *   <Copy size={14} />
 * </IconButton>
 * ```
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { variant = "ghost", size = "sm", label, className, children, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        // Base
        "inline-flex shrink-0 items-center justify-center",
        "transition-colors duration-150",
        "active:scale-[0.96] active:transition-transform active:duration-75",
        "disabled:pointer-events-none disabled:opacity-50",
        // Variant + size
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = "IconButton";
