import { useEffect, useRef, useCallback } from "react";

/**
 * Mouse-following radial spotlight for hero sections.
 * Renders a soft, diffused gradient that tracks the cursor —
 * like a stage light on a dark set.
 *
 * Respects prefers-reduced-motion by disabling the follow effect.
 */
export function HeroSpotlight({
  color = "0, 224, 208", // teal RGB
  size = 700,
  opacity = 0.07,
  className = "",
}: {
  /** RGB string, e.g. "0, 224, 208" */
  color?: string;
  /** Diameter of the spotlight in px */
  size?: number;
  /** Peak opacity of the gradient */
  opacity?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const posRef = useRef({ x: 0, y: 0 });
  const listeningParentRef = useRef<HTMLElement | null>(null);

  const handleMove = useCallback(
    (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      posRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          if (spotRef.current) {
            spotRef.current.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0) translate(-50%, -50%)`;
          }
          rafRef.current = 0;
        });
      }
    },
    [],
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const removeMoveListener = () => {
      listeningParentRef.current?.removeEventListener("mousemove", handleMove);
      listeningParentRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    const updateMotionListener = () => {
      removeMoveListener();
      if (mq.matches) return;
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      parent.addEventListener("mousemove", handleMove, { passive: true });
      listeningParentRef.current = parent;
    };

    updateMotionListener();
    mq.addEventListener("change", updateMotionListener);

    return () => {
      mq.removeEventListener("change", updateMotionListener);
      removeMoveListener();
    };
  }, [handleMove]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 ${className}`}
      aria-hidden="true"
    >
      <div
        ref={spotRef}
        className="absolute pointer-events-none transition-transform duration-[800ms] ease-out"
        style={{
          width: size,
          height: size,
          top: 0,
          left: 0,
          transform: "translate3d(50%, 50%, 0) translate(-50%, -50%)",
          background: `radial-gradient(circle, rgba(${color}, ${opacity}) 0%, rgba(${color}, ${opacity * 0.4}) 35%, transparent 70%)`,
          willChange: "transform",
        }}
      />
    </div>
  );
}
