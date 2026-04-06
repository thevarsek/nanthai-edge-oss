import {
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import {
  MockPanel,
  AccentDot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Themes & Appearance Illustration                                   */
/*  Shows dark/light mode toggle + accent colour swatches.             */
/* ------------------------------------------------------------------ */

function MockModeButton({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 transition-colors ${
        active
          ? "border-[var(--edge-cyan)]/30 bg-[var(--edge-cyan)]/5"
          : "border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)]"
      }`}
    >
      <div className={active ? "text-[var(--edge-cyan)]" : "efg-30"}>{icon}</div>
      <span className={`text-[10px] font-medium ${active ? "text-[var(--edge-cyan)]" : "efg-40"}`}>
        {label}
      </span>
    </div>
  );
}

function MockAccentSwatch({
  name,
  colors,
  active,
}: {
  name: string;
  colors: string[];
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
        active
          ? "border-[rgba(var(--edge-fg),0.12)] bg-[rgba(var(--edge-fg),0.04)]"
          : "border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)]"
      }`}
    >
      <div className="flex gap-1">
        {colors.map((c, i) => (
          <AccentDot key={i} color={c} size={12} />
        ))}
      </div>
      <span className="text-[11px] font-medium efg-50">{name}</span>
      {active && (
        <span className="ml-auto text-[9px] font-medium text-[var(--edge-cyan)]">Active</span>
      )}
    </div>
  );
}

export function ThemesIllustration() {
  return (
    <MockPanel showDots title="Appearance" className="max-w-sm mx-auto">
      {/* Mode selector */}
      <div className="mb-4">
        <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider mb-2 block">
          Mode
        </span>
        <div className="grid grid-cols-3 gap-2">
          <MockModeButton icon={<Sun size={16} />} label="Light" />
          <MockModeButton icon={<Moon size={16} />} label="Dark" active />
          <MockModeButton icon={<Monitor size={16} />} label="System" />
        </div>
      </div>

      {/* Accent themes */}
      <div>
        <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider mb-2 block">
          Accent Theme
        </span>
        <div className="space-y-2">
          <MockAccentSwatch
            name="Vibrant"
            colors={["#00C9A7", "#FF6B6B", "#FFD93D"]}
            active
          />
          <MockAccentSwatch
            name="High Contrast"
            colors={["#FFFFFF", "#FF4444", "#44FF44"]}
          />
          <MockAccentSwatch
            name="Teal"
            colors={["#2DD4BF", "#06B6D4", "#0D9488"]}
          />
          <MockAccentSwatch
            name="Lilac"
            colors={["#C084FC", "#A78BFA", "#818CF8"]}
          />
        </div>
      </div>
    </MockPanel>
  );
}
