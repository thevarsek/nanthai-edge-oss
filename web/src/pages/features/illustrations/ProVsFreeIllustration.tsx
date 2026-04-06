import {
  Crown,
  Check,
  X,
} from "lucide-react";
import {
  MockPanel,
  IconSlot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Pro vs Free Illustration                                           */
/*  Shows a comparison table with check/cross indicators.              */
/* ------------------------------------------------------------------ */

const rows = [
  { feature: "Multi-model chat", free: true, pro: true },
  { feature: "150+ AI models", free: true, pro: true },
  { feature: "Quick web search", free: true, pro: true },
  { feature: "Folders & organisation", free: true, pro: true },
  { feature: "Themes & appearance", free: true, pro: true },
  { feature: "BYOK (Bring Your Own Key)", free: true, pro: true },
  { feature: "Deep research", free: false, pro: true },
  { feature: "Personas", free: false, pro: true },
  { feature: "Memories", free: false, pro: true },
  { feature: "Scheduled tasks", free: false, pro: true },
  { feature: "Integrations", free: false, pro: true },
  { feature: "Knowledge base", free: false, pro: true },
  { feature: "Ideascapes", free: false, pro: true },
];

export function ProVsFreeIllustration() {
  return (
    <MockPanel className="max-w-md mx-auto overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_60px_60px] gap-2 px-3 py-2.5 border-b border-[rgba(var(--edge-fg),0.08)]">
        <span className="text-[10px] font-semibold efg-40">Feature</span>
        <span className="text-[10px] font-semibold efg-40 text-center">Free</span>
        <div className="flex items-center justify-center gap-1">
          <IconSlot icon={Crown} size={10} className="text-[var(--edge-coral)]" />
          <span className="text-[10px] font-semibold text-[var(--edge-coral)]">Pro</span>
        </div>
      </div>

      {/* Table rows */}
      <div className="divide-y divide-[rgba(var(--edge-fg),0.04)]">
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_60px_60px] gap-2 px-3 py-2 items-center"
          >
            <span className="text-[10px] efg-45">{row.feature}</span>
            <div className="flex justify-center">
              {row.free ? (
                <IconSlot icon={Check} size={12} className="text-[var(--edge-cyan)]" />
              ) : (
                <IconSlot icon={X} size={12} className="efg-15" />
              )}
            </div>
            <div className="flex justify-center">
              <IconSlot icon={Check} size={12} className="text-[var(--edge-coral)]" />
            </div>
          </div>
        ))}
      </div>

      {/* Price footer */}
      <div className="grid grid-cols-[1fr_60px_60px] gap-2 px-3 py-3 border-t border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)]">
        <span className="text-[10px] font-semibold efg-50">Price</span>
        <span className="text-[10px] font-semibold text-[var(--edge-cyan)] text-center">$0</span>
        <span className="text-[10px] font-semibold text-[var(--edge-coral)] text-center">$4.99</span>
      </div>
    </MockPanel>
  );
}
