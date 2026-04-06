import { DollarSign, Wallet, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MockPanel,
  SkeletonCircle,
  IconSlot,
  AccentDot,
  SkeletonLine,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Price Transparency Illustration                                     */
/*  Shows: chat header with cost, per-message cost, balance, breakdown */
/* ------------------------------------------------------------------ */

/** Animates a number counting up from 0 to `target` */
function CountUp({ target, prefix = "$", decimals = 4 }: { target: number; prefix?: string; decimals?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 1200;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(target * ease);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <>{prefix}{val.toFixed(decimals)}</>;
}

function MockMessageRow({
  label,
  cost,
  lines = 2,
  color,
  delay = 0,
}: {
  label: string;
  cost: number;
  lines?: number;
  color: string;
  delay?: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className="flex gap-2 py-2 transition-all duration-500"
      style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(6px)" }}
    >
      <SkeletonCircle size={22} shade="light">
        <span style={{ color, fontSize: 8, fontWeight: 700 }}>{label[0]}</span>
      </SkeletonCircle>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-medium efg-40">{label}</span>
          <span className="text-[9px] font-mono shrink-0" style={{ color }}>
            {visible ? <CountUp target={cost} /> : "$—"}
          </span>
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} width={i === lines - 1 ? "55%" : "90%"} shade="light" />
        ))}
        <span className="text-[8px] efg-25 font-mono mt-0.5">16:33 · <CountUp target={cost} /></span>
      </div>
    </div>
  );
}

function BreakdownRow({ label, amount, color }: { label: string; amount: number; color?: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[9px] efg-40">{label}</span>
      <span className="text-[9px] font-mono font-medium" style={{ color: color ?? "inherit" }}>
        <CountUp target={amount} />
      </span>
    </div>
  );
}

export function PriceTransparencyIllustration() {
  const [showBreakdown, setShowBreakdown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowBreakdown(true), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <MockPanel showDots className="max-w-sm mx-auto overflow-visible">
      {/* Chat header row */}
      <div className="flex items-center justify-between pb-3 mb-1 border-b border-[rgba(var(--edge-fg),0.06)]">
        <div className="flex-1 text-center">
          <p className="text-[11px] font-semibold efg-80">Research session</p>
          <button
            className="text-[9px] font-mono efg-40 hover:efg-60 transition-colors flex items-center gap-0.5 mx-auto"
            onClick={() => setShowBreakdown((v) => !v)}
          >
            GPT-4o · <CountUp target={0.0158} />
            <ChevronDown size={8} className={`transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
          </button>
        </div>
        {/* Balance chip */}
        <div className="flex items-center gap-1 rounded-full border border-[var(--edge-cyan)]/20 bg-[var(--edge-cyan)]/5 px-2 py-0.5">
          <IconSlot icon={Wallet} size={8} className="text-[var(--edge-cyan)]" />
          <span className="text-[8px] font-mono text-[var(--edge-cyan)]">$4.83</span>
        </div>
      </div>

      {/* Breakdown popover */}
      <div
        className="overflow-hidden transition-all duration-400"
        style={{ maxHeight: showBreakdown ? 120 : 0, opacity: showBreakdown ? 1 : 0 }}
      >
        <div className="rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.03)] px-3 py-2 mb-3">
          <p className="text-[8px] font-semibold efg-30 uppercase tracking-wider mb-1.5">Cost breakdown</p>
          <BreakdownRow label="Responses" amount={0.0084} color="var(--edge-cyan)" />
          <BreakdownRow label="Memory" amount={0.0048} color="var(--edge-amber)" />
          <BreakdownRow label="Search" amount={0.0026} color="var(--edge-blue, #60a5fa)" />
          <SkeletonDivider />
          <div className="flex justify-between items-center pt-0.5">
            <span className="text-[9px] font-semibold efg-60">Total</span>
            <span className="text-[9px] font-mono font-semibold text-[var(--edge-cyan)]">
              <CountUp target={0.0158} />
            </span>
          </div>
        </div>
      </div>

      {/* Message rows */}
      <div className="flex flex-col divide-y divide-[rgba(var(--edge-fg),0.04)]">
        <MockMessageRow label="GPT-4o" cost={0.0029} lines={3} color="var(--edge-cyan)" delay={200} />
        <MockMessageRow label="Claude Haiku" cost={0.0055} lines={2} color="var(--edge-amber)" delay={600} />
        <MockMessageRow label="Gemini Pro" cost={0.0074} lines={2} color="var(--edge-blue, #60a5fa)" delay={1000} />
      </div>

      {/* Balance bar */}
      <div className="mt-3 pt-2.5 border-t border-[rgba(var(--edge-fg),0.06)] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AccentDot color="var(--edge-cyan)" size={5} />
          <span className="text-[8px] efg-30">OpenRouter balance</span>
        </div>
        <div className="flex items-center gap-1">
          <IconSlot icon={DollarSign} size={9} className="text-[var(--edge-cyan)]" />
          <span className="text-[9px] font-mono font-semibold text-[var(--edge-cyan)]">4.83 remaining</span>
        </div>
      </div>
    </MockPanel>
  );
}
