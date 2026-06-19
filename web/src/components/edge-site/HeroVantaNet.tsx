import { useEffect, useRef, useState } from "react";
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
  lightColor = color,
  backgroundColor = 0x050507,
  lightBackgroundColor = backgroundColor,
  opacity = 0.35,
  lightOpacity = opacity,
  maxDistance = 22,
  lightMaxDistance = maxDistance,
  mobileMaxDistance,
  lightMobileMaxDistance,
  scale = 1,
  scaleMobile = scale,
  lineColor,
  lightLineColor = lineColor,
  lineOpacity = 1,
  lightLineOpacity = lineOpacity,
  className = "",
}: {
  /** Hex integer for line/dot color */
  color?: number;
  /** Hex integer for line/dot color on light backgrounds */
  lightColor?: number;
  /** Hex integer matching the dark page background. Used by Vanta's line color math. */
  backgroundColor?: number;
  /** Hex integer matching the light page background. Used by Vanta's line color math. */
  lightBackgroundColor?: number;
  /** Container opacity (0-1). Keep low to stay subtle. */
  opacity?: number;
  /** Container opacity on light backgrounds */
  lightOpacity?: number;
  /** Maximum point distance for connecting lines */
  maxDistance?: number;
  /** Maximum point distance for connecting lines on light backgrounds */
  lightMaxDistance?: number;
  /** Maximum point distance on narrow/mobile viewports */
  mobileMaxDistance?: number;
  /** Maximum point distance on narrow/mobile light viewports */
  lightMobileMaxDistance?: number;
  /** Vanta render scale. Higher values lower canvas pixel ratio and improve frame pacing. */
  scale?: number;
  /** Vanta render scale on mobile/narrow screens */
  scaleMobile?: number;
  /** Optional uniform line color override */
  lineColor?: number;
  /** Optional uniform line color override on light backgrounds */
  lightLineColor?: number;
  /** Uniform line material opacity */
  lineOpacity?: number;
  /** Uniform line material opacity on light backgrounds */
  lightLineOpacity?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vantaRef = useRef<{ destroy: () => void } | null>(null);
  const [isLightTheme, setIsLightTheme] = useState(() => resolveIsLightTheme());
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => resolveIsNarrowViewport());
  const resolvedColor = isLightTheme ? lightColor : color;
  const resolvedBackgroundColor = isLightTheme ? lightBackgroundColor : backgroundColor;
  const resolvedOpacity = isLightTheme ? lightOpacity : opacity;
  const resolvedDesktopMaxDistance = isLightTheme ? lightMaxDistance : maxDistance;
  const resolvedMobileMaxDistance = isLightTheme
    ? lightMobileMaxDistance ?? mobileMaxDistance
    : mobileMaxDistance;
  const resolvedMaxDistance = isNarrowViewport
    ? resolvedMobileMaxDistance ?? resolvedDesktopMaxDistance
    : resolvedDesktopMaxDistance;
  const resolvedLineColor = isLightTheme ? lightLineColor : lineColor;
  const resolvedLineOpacity = isLightTheme ? lightLineOpacity : lineOpacity;

  useEffect(() => {
    const updateTheme = () => setIsLightTheme(resolveIsLightTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const scheme = window.matchMedia("(prefers-color-scheme: light)");
    scheme.addEventListener("change", updateTheme);
    updateTheme();

    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", updateTheme);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 599px)");
    const updateViewport = () => setIsNarrowViewport(query.matches);
    query.addEventListener("change", updateViewport);
    updateViewport();

    return () => {
      query.removeEventListener("change", updateViewport);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;

    const destroyVanta = () => {
      if (!vantaRef.current) return;
      try {
        vantaRef.current.destroy();
      } catch {
        /* noop */
      }
      vantaRef.current = null;
    };

    const syncVanta = () => {
      if (cancelled) return;
      if (mq.matches) {
        destroyVanta();
        return;
      }

      try {
        if (!vantaRef.current && containerRef.current) {
          const instance = VANTA_NET({
            THREE,
            el: containerRef.current,
            mouseControls: true,
            touchControls: true,
            gyroControls: false,
            minHeight: 200,
            minWidth: 200,
            scale,
            scaleMobile,
            color: resolvedColor,
            backgroundColor: resolvedBackgroundColor,
            maxDistance: resolvedMaxDistance,
            spacing: 18,
            backgroundAlpha: 0,
            showDots: true,
            points: 7,
          });
          applyUniformLineMaterial(instance, resolvedLineColor, resolvedLineOpacity);
          vantaRef.current = instance;
        }
      } catch (err) {
        console.error("Vanta hero background failed to initialize", err);
      }
    };

    syncVanta();
    mq.addEventListener("change", syncVanta);

    return () => {
      cancelled = true;
      mq.removeEventListener("change", syncVanta);
      destroyVanta();
    };
  }, [
    resolvedBackgroundColor,
    resolvedColor,
    resolvedLineColor,
    resolvedLineOpacity,
    resolvedMaxDistance,
    scale,
    scaleMobile,
  ]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        opacity: resolvedOpacity,
      }}
      aria-hidden="true"
    />
  );
}

function resolveIsLightTheme(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "light") return true;
  if (theme === "dark") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function resolveIsNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 600;
}

type VantaNetInstance = {
  destroy: () => void;
  linesMesh?: {
    material?: THREE.LineBasicMaterial | THREE.LineBasicMaterial[];
  };
};

function applyUniformLineMaterial(
  instance: VantaNetInstance,
  color: number | undefined,
  opacity: number,
) {
  if (color === undefined) return;
  const materials = instance.linesMesh?.material;
  const lineMaterials = Array.isArray(materials) ? materials : materials ? [materials] : [];

  lineMaterials.forEach((material) => {
    material.vertexColors = false;
    material.color.set(color);
    material.opacity = Math.max(0, Math.min(1, opacity));
    material.transparent = material.opacity < 1;
    material.blending = THREE.NormalBlending;
    material.needsUpdate = true;
  });
}
