import {
  Search,
  Sparkles,
  ArrowUpDown,
  Eye,
  Wrench,
  Gift,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  IconSlot,
  AccentDot,
  SkeletonDivider,
  MockProviderAvatar,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Participant Options Illustration                                    */
/*  Shows the participant picker with search, filter chips, sort,       */
/*  model rows, and a wizard button.                                    */
/* ------------------------------------------------------------------ */

function MockFilterChip({
  label,
  icon,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-medium transition-colors ${
        active
          ? "border-[var(--edge-cyan)]/30 bg-[var(--edge-cyan)]/8 text-[var(--edge-cyan)]"
          : "border-[rgba(var(--edge-fg),0.08)] efg-35"
      }`}
    >
      {icon}
      {label}
    </div>
  );
}

function MockModelRow({
  label,
  color,
  name,
  tags,
  selected,
}: {
  label: string;
  color: string;
  name: string;
  tags: string[];
  selected?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2 px-1">
      <MockProviderAvatar label={label} color={color} size={30} />
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-medium efg-60">{name}</span>
        <div className="flex gap-1 mt-0.5">
          {tags.map((t, i) => (
            <span key={i} className="text-[8px] rounded bg-[rgba(var(--edge-fg),0.05)] px-1.5 py-0.5 efg-30">
              {t}
            </span>
          ))}
        </div>
      </div>
      {selected && <AccentDot color="var(--edge-cyan)" size={8} />}
    </div>
  );
}

export function ParticipantOptionsIllustration() {
  return (
    <MockPanel showDots title="Participants" className="max-w-sm mx-auto">
      {/* Search bar */}
      <div className="flex items-center gap-2 rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] px-3 py-2 mb-3">
        <IconSlot icon={Search} size={12} className="efg-25" />
        <SkeletonLine width="55%" height="xs" shade="light" />
      </div>

      {/* Filter chips + wizard button */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <MockFilterChip label="Free" icon={<Gift size={9} />} />
        <MockFilterChip label="Vision" icon={<Eye size={9} />} active />
        <MockFilterChip label="Tools" icon={<Wrench size={9} />} />
        <div className="ml-auto flex items-center gap-1.5">
          <div className="inline-flex items-center gap-1 rounded-full border border-[var(--edge-amber)]/30 bg-[var(--edge-amber)]/8 px-2.5 py-1">
            <IconSlot icon={Sparkles} size={9} className="text-[var(--edge-amber)]" />
            <span className="text-[9px] font-medium text-[var(--edge-amber)]">Help me choose</span>
          </div>
        </div>
      </div>

      {/* Sort indicator */}
      <div className="flex items-center gap-1 mb-2">
        <IconSlot icon={ArrowUpDown} size={10} className="efg-25" />
        <span className="text-[9px] font-medium efg-30">Recommended</span>
      </div>

      {/* Model rows */}
      <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] px-2">
        <MockModelRow
          label="C"
          color="var(--edge-coral)"
          name="Claude 4 Sonnet"
          tags={["Vision", "Tools", "200K ctx"]}
          selected
        />
        <SkeletonDivider />
        <MockModelRow
          label="G"
          color="var(--edge-cyan)"
          name="ChatGPT o3"
          tags={["Vision", "Tools", "128K ctx"]}
          selected
        />
        <SkeletonDivider />
        <MockModelRow
          label="G"
          color="var(--edge-blue, #60a5fa)"
          name="Gemini 2.5 Pro"
          tags={["Vision", "1M ctx"]}
        />
        <SkeletonDivider />
        <MockModelRow
          label="L"
          color="var(--edge-amber)"
          name="Llama 4 Maverick"
          tags={["Free", "Tools"]}
        />
      </div>

      {/* Selected count */}
      <div className="flex justify-center mt-3">
        <span className="text-[9px] font-medium efg-35">2 of 3 selected</span>
      </div>
    </MockPanel>
  );
}
