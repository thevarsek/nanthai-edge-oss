import {
  Play,
  Download,
  Music,
  Send,
  Plus,
  Headphones,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  SkeletonCircle,
  IconSlot,
  AccentDot,
  MockProviderAvatar,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Audio Generation Illustration                                      */
/*  Shows: user prompt → generation progress → audio player bar        */
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

/* ── Generation progress area ────────────────────────────────────── */

function MockGenerationProgress() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <MockProviderAvatar label="♪" color="var(--edge-cyan)" size={28} />
      <div className="flex items-center gap-2 flex-1">
        <AccentDot color="var(--edge-cyan)" size={6} className="edge-shimmer" />
        <span className="text-[10px] font-medium efg-30">Generating...</span>
      </div>
    </div>
  );
}

/* ── Audio player bar ────────────────────────────────────────────── */

function MockAudioPlayer() {
  return (
    <div className="rounded-xl bg-[rgba(var(--edge-fg),0.02)] border border-[rgba(var(--edge-fg),0.08)] px-3 py-3">
      <div className="flex items-center gap-3">
        {/* Play button */}
        <SkeletonCircle size={32} shade="accent">
          <IconSlot icon={Play} size={14} className="text-white" />
        </SkeletonCircle>

        {/* Progress bar */}
        <div className="flex-1 flex flex-col gap-1.5">
          <SkeletonLine width="100%" height="xs" shade="medium" />
          <div className="flex justify-between">
            <span className="text-[9px] efg-25">0:00</span>
            <span className="text-[9px] efg-25">3:24</span>
          </div>
        </div>

        {/* Headphones icon */}
        <IconSlot icon={Headphones} size={14} className="efg-25" />
      </div>
    </div>
  );
}

/* ── Action bar ──────────────────────────────────────────────────── */

function MockActionBar() {
  return (
    <div className="flex items-center gap-3 mt-2 ml-2">
      <IconSlot icon={Download} size={12} className="efg-20 hover:efg-40 transition-colors" />
      <IconSlot icon={Music} size={12} className="efg-20" />
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

export function AudioGenerationIllustration() {
  return (
    <MockPanel showDots title="Audio Generation" className="max-w-lg mx-auto">
      <div className="px-2 py-4 space-y-3">
        {/* User message */}
        <MockUserBubble />

        {/* Generation progress */}
        <MockGenerationProgress />

        <SkeletonDivider />

        {/* Audio player */}
        <MockAudioPlayer />

        {/* Action bar */}
        <MockActionBar />
      </div>

      {/* Chat input */}
      <MockChatInput />
    </MockPanel>
  );
}
