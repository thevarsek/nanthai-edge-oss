import {
  Image,
  Download,
  Copy,
  Send,
  Plus,
  Palette,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  SkeletonCircle,
  IconSlot,
  MockProviderAvatar,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Image Generation Illustration                                      */
/*  Shows: user prompt → generated image placeholder → action bar      */
/* ------------------------------------------------------------------ */

/* ── User message bubble ─────────────────────────────────────────── */

function MockUserBubble() {
  return (
    <div className="flex justify-end mb-4">
      <div className="rounded-xl px-4 py-2.5 bg-[var(--edge-coral)] max-w-[70%]">
        <SkeletonLine width="90%" height="sm" className="bg-white/20" />
        <SkeletonLine width="55%" height="sm" className="bg-white/20 mt-1.5" />
      </div>
    </div>
  );
}

/* ── Generated image placeholder ─────────────────────────────────── */

function MockImagePlaceholder() {
  return (
    <div className="flex items-start gap-2.5 px-2">
      <MockProviderAvatar label="I" color="var(--edge-amber)" size={28} />
      <div className="flex-1 min-w-0">
        {/* Model name */}
        <div className="flex items-center gap-1.5 mb-2">
          <SkeletonLine width="70px" height="xs" shade="medium" />
        </div>

        {/* Image placeholder — dashed border with centered icon */}
        <div
          className="rounded-xl border-2 border-dashed border-[rgba(var(--edge-fg),0.12)] bg-[rgba(var(--edge-fg),0.02)] flex items-center justify-center"
          style={{ aspectRatio: "4 / 3" }}
        >
          <div className="flex flex-col items-center gap-2">
            <IconSlot icon={Image} size={28} className="efg-15" />
            <SkeletonLine width="60px" height="xs" shade="light" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Action bar ──────────────────────────────────────────────────── */

function MockActionBar() {
  return (
    <div className="flex items-center gap-3 mt-2 ml-[44px]">
      <IconSlot icon={Download} size={12} className="efg-20 hover:efg-40 transition-colors" />
      <IconSlot icon={Copy} size={12} className="efg-20" />
      <IconSlot icon={Palette} size={12} className="efg-20" />
    </div>
  );
}

/* ── Chat input bar ──────────────────────────────────────────────── */

function MockChatInput() {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[rgba(var(--edge-fg),0.06)]">
      <SkeletonCircle size={30} shade="light">
        <IconSlot icon={Plus} size={14} className="efg-30" />
      </SkeletonCircle>
      <div className="flex-1 rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] px-3 py-2">
        <SkeletonLine width="45%" height="sm" shade="light" />
      </div>
      <SkeletonCircle size={30} shade="accent">
        <IconSlot icon={Send} size={13} className="text-white" />
      </SkeletonCircle>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */

export function ImageGenerationIllustration() {
  return (
    <MockPanel showDots title="Image Generation" className="max-w-lg mx-auto">
      <div className="px-2 py-4 space-y-3">
        {/* User message */}
        <MockUserBubble />

        {/* Generated image */}
        <MockImagePlaceholder />

        <SkeletonDivider className="ml-[44px] mr-2" />

        {/* Action bar */}
        <MockActionBar />
      </div>

      {/* Chat input */}
      <MockChatInput />
    </MockPanel>
  );
}
