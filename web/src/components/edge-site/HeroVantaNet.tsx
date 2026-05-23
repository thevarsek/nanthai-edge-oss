import { useEffect, useRef } from "react";
import * as THREE from "three";
import VANTA_NET from "vanta/dist/vanta.net.min";

/**
 * Vanta.js NET effect scoped to a container (not full-page).
 * Starts the bundled Three.js + Vanta effect on mount, destroys on unmount.
 * Very low opacity — acts as subliminal texture behind hero text.
 *
 * Respects prefers-reduced-motion by not initializing at all.
 */

export function HeroVantaNet({
  color = 0x00e0d0, // teal
  backgroundColor = 0x050507,
  opacity = 0.35,
  className = "",
}: {
  /** Hex integer for line/dot color */
  color?: number;
  /** Hex integer for background */
  backgroundColor?: number;
  /** Container opacity (0-1). Keep low to stay subtle. */
  opacity?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vantaRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    // Bail on reduced motion
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    let cancelled = false;

    try {
      if (!cancelled && !vantaRef.current && containerRef.current) {
        vantaRef.current = VANTA_NET({
          THREE,
          el: containerRef.current,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1.0,
          scaleMobile: 1.0,
          color,
          backgroundColor,
          maxDistance: 22,
          spacing: 18,
          backgroundAlpha: 0,
          showDots: true,
          points: 7,
        });
      }
    } catch (err) {
      console.error("Vanta hero background failed to initialize", err);
    }

    return () => {
      cancelled = true;
      if (vantaRef.current) {
        try {
          vantaRef.current.destroy();
        } catch {
          /* noop */
        }
        vantaRef.current = null;
      }
    };
  }, [color, backgroundColor]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ opacity }}
      aria-hidden="true"
    />
  );
}
