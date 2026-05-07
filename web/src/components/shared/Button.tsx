import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ── Variants ────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerFilled";
type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary/90 active:bg-primary/80 shadow-sm shadow-primary/20",
  secondary:
    "bg-surface-2 text-foreground hover:bg-surface-3 active:bg-surface-3/80 border border-border/30",
  ghost:
    "text-foreground/70 hover:text-foreground hover:bg-foreground/8 active:bg-foreground/12",
  danger:
    "text-destructive hover:bg-destructive/10 active:bg-destructive/15",
  dangerFilled:
    "bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-3 text-xs gap-1.5 rounded-xl",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-11 px-6 text-sm gap-2.5 rounded-xl",
};

// ── Component ───────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional icon to render before the label. */
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * Shared button with standardized interactive states.
 *
 * Includes hover, active (pressed scale), focus-visible ring, and disabled styling.
 *
 * ```tsx
 * <Button variant="primary" size="md" icon={<Plus size={16} />}>
 *   New chat
 * </Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        // Base
        "inline-flex shrink-0 items-center justify-center font-medium",
        "transition-[colors,transform] duration-150",
        "active:scale-[0.98] active:duration-75",
        "disabled:pointer-events-none disabled:opacity-50",
        // Variant + size
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  ),
);

Button.displayName = "Button";
