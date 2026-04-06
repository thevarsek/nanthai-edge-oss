import { useEffect, useRef, useState } from "react";

/**
 * SVG-based outline text for hero headlines.
 *
 * Uses SVG `<text>` with `paint-order="stroke"` so the stroke renders first,
 * then a solid fill matching the page background covers the inner counter
 * strokes. This produces a clean "outer outline only" effect — the A, P, R,
 * Y, W counters stay open because their inner paths are painted over by fill.
 *
 * Each line can be:
 * - A plain string (white stroke)
 * - An object `{ text, accentSuffix? }` (legacy format — trailing accent char)
 * - An array of segments `{ text, accent? }[]` — accent segments use accentColor
 *
 * The component auto-measures its text bounding box on mount + resize so the
 * SVG viewBox fits tightly with no manual coordinate guessing.
 */

type Segment = { text: string; accent?: boolean };
type LineDef =
  | string
  | { text: string; accentSuffix?: string }
  | Segment[];

export function HeroOutlineText({
  lines,
  align = "right",
  strokeWidth = 2,
  strokeColor = "rgba(var(--edge-fg, 255, 255, 255), 0.95)",
  accentColor = "#FF6B3D",
  fillColor = "var(--edge-bg, #050507)",
  className = "",
}: {
  /** Array of line definitions — string, legacy object, or segment array */
  lines: LineDef[];
  /** Text alignment within the SVG */
  align?: "left" | "right";
  /** Stroke width in SVG user units */
  strokeWidth?: number;
  /** Stroke color for normal text */
  strokeColor?: string;
  /** Stroke color for accent segments */
  accentColor?: string;
  /** Fill color — must match the page background to mask inner counter strokes */
  fillColor?: string;
  /** Additional classes on the wrapper */
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState<string>("0 0 1000 200");

  // Font: Inter 900, matching .edge-display-xl
  const fontStyle: React.CSSProperties = {
    fontFamily: '"Inter", system-ui, sans-serif',
    fontWeight: 900,
    letterSpacing: "-0.05em",
    textTransform: "uppercase" as const,
  };

  // Font size in SVG units — large enough for precision, viewBox scales it
  const fontSize = 100;
  const lineHeight = fontSize * 0.92; // tight leading matching line-height: 0.9

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Wait a frame for fonts to load and text to render
    const measure = () => {
      const bbox = svg.getBBox();
      if (bbox.width === 0) return;

      const pad = strokeWidth * 2;
      setViewBox(
        `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`,
      );
    };

    // Measure after fonts load
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(measure));
    } else {
      requestAnimationFrame(measure);
    }

    // Re-measure on resize (font metrics can shift)
    const handleResize = () => requestAnimationFrame(measure);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [lines, strokeWidth]);

  const textAnchor = align === "right" ? "end" : "start";
  // For right-align, place x at a large value; viewBox auto-crops via getBBox
  const xPos = align === "right" ? 2000 : 0;

  // Normalize every line into a Segment[]
  const normalizedLines: Segment[][] = lines.map((line) => {
    if (typeof line === "string") {
      return [{ text: line }];
    }
    if (Array.isArray(line)) {
      return line;
    }
    // Legacy { text, accentSuffix? }
    const segs: Segment[] = [{ text: line.text }];
    if (line.accentSuffix) {
      segs.push({ text: line.accentSuffix, accent: true });
    }
    return segs;
  });

  const ariaLabel = normalizedLines
    .map((segs) => segs.map((s) => s.text).join(""))
    .join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      width="100%"
      preserveAspectRatio={
        align === "right" ? "xMaxYMid meet" : "xMinYMid meet"
      }
      className={className}
      aria-label={ariaLabel}
      role="img"
    >
      {normalizedLines.map((segments, i) => (
        <text
          key={i}
          x={xPos}
          y={fontSize + i * lineHeight}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          paintOrder="stroke"
          textAnchor={textAnchor}
          style={fontStyle}
          fontSize={fontSize}
        >
          {segments.map((seg, j) =>
            seg.accent ? (
              <tspan key={j} stroke={accentColor}>
                {seg.text}
              </tspan>
            ) : (
              <tspan key={j}>{seg.text}</tspan>
            ),
          )}
        </text>
      ))}
    </svg>
  );
}
