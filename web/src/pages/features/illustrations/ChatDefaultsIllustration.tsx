import {
  SlidersHorizontal,
  Thermometer,
  Hash,
  Star,
  ChevronRight,
} from "lucide-react";
import {
  MockPanel,
  SkeletonCircle,
  MockProviderAvatar,
  IconSlot,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Chat Defaults & Favorites Illustration                             */
/*  Shows a settings panel with default model/temp/tokens + favorites  */
/*  strip at the top of chat list.                                     */
/* ------------------------------------------------------------------ */

function MockSettingRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="efg-30">{icon}</div>
        <span className="text-[11px] font-medium efg-50">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] efg-35">{value}</span>
        <IconSlot icon={ChevronRight} size={10} className="efg-20" />
      </div>
    </div>
  );
}

function MockFavoriteStrip() {
  const favs = [
    { label: "G", color: "var(--edge-cyan)", name: "ChatGPT" },
    { label: "C", color: "var(--edge-coral)", name: "Claude" },
    { label: "M", color: "var(--edge-amber)", name: "Mistral" },
  ];

  return (
    <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-3">
      <div className="flex items-center gap-1.5 mb-3">
        <IconSlot icon={Star} size={12} className="text-[var(--edge-amber)]" />
        <span className="text-[10px] font-semibold efg-40 uppercase tracking-wider">Favorites</span>
      </div>
      <div className="flex items-center gap-4">
        {favs.map((f, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <MockProviderAvatar label={f.label} color={f.color} size={40} />
            <span className="text-[9px] efg-30 truncate max-w-[48px]">{f.name}</span>
          </div>
        ))}
        {/* Multi-model combo */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative" style={{ width: 40, height: 40 }}>
            <MockProviderAvatar
              label="G"
              color="var(--edge-cyan)"
              size={26}
              className="absolute top-0 left-0 ring-2 ring-[rgba(var(--edge-fg),0.03)]"
            />
            <MockProviderAvatar
              label="C"
              color="var(--edge-coral)"
              size={26}
              className="absolute bottom-0 right-0 ring-2 ring-[rgba(var(--edge-fg),0.03)]"
            />
          </div>
          <span className="text-[9px] efg-30 truncate max-w-[48px]">G + C</span>
        </div>
        {/* Add button */}
        <SkeletonCircle size={40} shade="light">
          <span className="text-[16px] efg-25">+</span>
        </SkeletonCircle>
      </div>
    </div>
  );
}

export function ChatDefaultsIllustration() {
  return (
    <MockPanel showDots title="Chat Defaults" className="max-w-md mx-auto">
      {/* Settings section */}
      <div className="mb-4">
        <MockSettingRow
          icon={<IconSlot icon={SlidersHorizontal} size={14} />}
          label="Default Model"
          value="ChatGPT"
        />
        <SkeletonDivider />
        <MockSettingRow
          icon={<IconSlot icon={Thermometer} size={14} />}
          label="Temperature"
          value="0.7"
        />
        <SkeletonDivider />
        <MockSettingRow
          icon={<IconSlot icon={Hash} size={14} />}
          label="Max Tokens"
          value="4,096"
        />
      </div>

      {/* Favorites strip */}
      <MockFavoriteStrip />
    </MockPanel>
  );
}
