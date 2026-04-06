import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Illustration Primitives                                           */
/*  Reusable "wireframe" building blocks for feature page visuals.    */
/*  All rendering is pure CSS — no external animation libraries.      */
/* ------------------------------------------------------------------ */

/* ── Scroll-triggered entrance animation ─────────────────────────── */

export function AnimateOnScroll({
  children,
  className,
  animation = "edge-fade-up",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  animation?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-none",
        visible ? animation : "opacity-0 translate-y-6",
        className,
      )}
      style={{
        animationDelay: visible ? `${delay}s` : undefined,
        animationFillMode: "both",
      }}
    >
      {children}
    </div>
  );
}

/* ── Mock Panel ──────────────────────────────────────────────────── */

export function MockPanel({
  children,
  className,
  title,
  showDots,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  showDots?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border overflow-hidden",
        "bg-[rgba(var(--edge-fg),0.03)] border-[rgba(var(--edge-fg),0.08)]",
        className,
      )}
    >
      {(showDots || title) && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgba(var(--edge-fg),0.06)]">
          {showDots && (
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[rgba(var(--edge-fg),0.12)]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[rgba(var(--edge-fg),0.08)]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[rgba(var(--edge-fg),0.08)]" />
            </div>
          )}
          {title && (
            <span className="text-[11px] font-medium efg-30 ml-1">
              {title}
            </span>
          )}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ── Skeleton primitives ─────────────────────────────────────────── */

type SkeletonShade = "light" | "medium" | "dark" | "accent";

const shadeMap: Record<SkeletonShade, string> = {
  light: "bg-[rgba(var(--edge-fg),0.06)]",
  medium: "bg-[rgba(var(--edge-fg),0.10)]",
  dark: "bg-[rgba(var(--edge-fg),0.16)]",
  accent: "bg-[var(--edge-cyan)]",
};

export function SkeletonLine({
  width = "100%",
  height = "sm",
  shade = "light",
  className,
  shimmer,
}: {
  width?: string;
  height?: "xs" | "sm" | "md" | "lg";
  shade?: SkeletonShade;
  className?: string;
  shimmer?: boolean;
}) {
  const heightMap = { xs: "h-1.5", sm: "h-2", md: "h-2.5", lg: "h-3" };
  return (
    <div
      className={cn(
        "rounded-full",
        heightMap[height],
        shadeMap[shade],
        shimmer && "edge-shimmer",
        className,
      )}
      style={{ width }}
    />
  );
}

export function SkeletonCircle({
  size = 28,
  shade = "medium",
  className,
  children,
}: {
  size?: number;
  shade?: SkeletonShade;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center",
        shadeMap[shade],
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}

export function SkeletonCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        "bg-[rgba(var(--edge-fg),0.02)] border-[rgba(var(--edge-fg),0.06)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Chat-specific primitives ────────────────────────────────────── */

export function SkeletonBubble({
  align = "left",
  lines = 3,
  className,
  accentColor,
}: {
  align?: "left" | "right";
  lines?: number;
  className?: string;
  accentColor?: string;
}) {
  const widths = ["85%", "100%", "65%", "90%", "45%"];
  const isUser = align === "right";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-xl px-3.5 py-2.5 flex flex-col gap-1.5",
          isUser
            ? "bg-[var(--edge-coral)] max-w-[70%]"
            : "max-w-[85%]",
          !isUser && "bg-[rgba(var(--edge-fg),0.03)]",
        )}
        style={
          accentColor && !isUser
            ? { borderLeft: `2px solid ${accentColor}` }
            : undefined
        }
      >
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={widths[i % widths.length]}
            shade={isUser ? "light" : "light"}
            height="sm"
            className={isUser ? "bg-white/20" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonInput({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2.5",
        "bg-[rgba(var(--edge-fg),0.02)] border-[rgba(var(--edge-fg),0.08)]",
        className,
      )}
    >
      <SkeletonLine width="60%" shade="light" height="sm" />
    </div>
  );
}

/* ── Icon Slot — renders a real Lucide icon in wireframe context ── */

export function IconSlot({
  icon: Icon,
  size = 16,
  className,
}: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  size?: number;
  className?: string;
}) {
  return (
    <Icon
      size={size}
      className={cn("shrink-0 efg-40", className)}
    />
  );
}

/* ── Divider line matching multi-model group style ───────────────── */

export function SkeletonDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-px my-2",
        "bg-[rgba(var(--edge-fg),0.06)]",
        className,
      )}
    />
  );
}

/* ── Accent dot — small colored indicator ────────────────────────── */

export function AccentDot({
  color = "var(--edge-cyan)",
  size = 6,
  className,
}: {
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-full shrink-0", className)}
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

/* ── Provider avatar — circle with provider-like appearance ──────── */

export function MockProviderAvatar({
  label,
  color,
  size = 28,
  className,
}: {
  label: string;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}22`,
        color: color,
        fontSize: size * 0.38,
      }}
    >
      {label}
    </div>
  );
}
