import { useEffect, useRef } from "react";

/**
 * Vanta.js NET effect scoped to a container (not full-page).
 * Loads Three.js + Vanta from CDN on first mount, destroys on unmount.
 * Very low opacity — acts as subliminal texture behind hero text.
 *
 * Respects prefers-reduced-motion by not initializing at all.
 */

let threeJsLoaded: Promise<void> | null = null;
let vantaLoaded: Promise<void> | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

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
  const vantaRef = useRef<unknown>(null);

  useEffect(() => {
    // Bail on reduced motion
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    if (!threeJsLoaded) {
      threeJsLoaded = loadScriptOnce(
        "https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js",
      );
    }
    if (!vantaLoaded) {
      vantaLoaded = threeJsLoaded.then(() =>
        loadScriptOnce(
          "https://cdnjs.cloudflare.com/ajax/libs/vanta/0.5.24/vanta.net.min.js",
        ),
      );
    }

    vantaLoaded
      .then(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (!w.VANTA || vantaRef.current || !containerRef.current) return;

        vantaRef.current = w.VANTA.NET({
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
      })
      .catch((err) => {
        console.error("Vanta hero background failed to initialize", err);
      });

    return () => {
      if (vantaRef.current) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (vantaRef.current as any).destroy();
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
