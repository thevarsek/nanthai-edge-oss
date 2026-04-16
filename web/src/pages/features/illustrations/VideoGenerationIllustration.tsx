import {
  Play,
  Download,
  Maximize,
  Film,
  Send,
  Plus,
  ImagePlus,
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
/*  Video Generation Illustration                                      */
/*  Shows: user prompt → frame attachments → video player → status     */
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

/* ── Frame attachment thumbnails ─────────────────────────────────── */

function MockFrameThumbnails() {
  return (
    <div className="flex items-center gap-2 px-2 mb-2">
      <IconSlot icon={ImagePlus} size={12} className="efg-25" />
      <span className="text-[10px] font-medium efg-30">Attached frames</span>
    </div>
  );
}

function MockFramePair() {
  return (
    <div className="flex gap-2 px-2 mb-3">
      {/* First frame */}
      <div className="flex-1 rounded-lg border border-dashed border-[rgba(var(--edge-fg),0.12)] bg-[rgba(var(--edge-fg),0.02)] p-2 flex flex-col items-center gap-1">
        <IconSlot icon={ImagePlus} size={16} className="efg-15" />
        <span className="text-[8px] font-medium efg-25">1st</span>
      </div>
      {/* Last frame */}
      <div className="flex-1 rounded-lg border border-dashed border-[rgba(var(--edge-fg),0.12)] bg-[rgba(var(--edge-fg),0.02)] p-2 flex flex-col items-center gap-1">
        <IconSlot icon={ImagePlus} size={16} className="efg-15" />
        <span className="text-[8px] font-medium efg-25">Last</span>
      </div>
    </div>
  );
}

/* ── Video player area ───────────────────────────────────────────── */

function MockVideoPlayer() {
  return (
    <div className="px-2">
      <div className="flex items-start gap-2.5">
        <MockProviderAvatar label="V" color="var(--edge-cyan)" size={28} />
        <div className="flex-1 min-w-0">
          {/* Model name */}
          <div className="flex items-center gap-1.5 mb-2">
            <SkeletonLine width="65px" height="xs" shade="medium" />
          </div>

          {/* 16:9 video container */}
          <div
            className="rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.03)] flex items-center justify-center relative"
            style={{ aspectRatio: "16 / 9" }}
          >
            {/* Play triangle */}
            <SkeletonCircle size={40} shade="medium">
              <IconSlot icon={Play} size={18} className="efg-40" />
            </SkeletonCircle>
          </div>

          {/* Progress bar */}
          <div className="mt-2">
            <SkeletonLine width="100%" height="xs" shade="light" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Generation status line ──────────────────────────────────────── */

function MockGenerationStatus() {
  return (
    <div className="flex items-center gap-2 ml-[44px]">
      <AccentDot color="var(--edge-cyan)" size={6} className="edge-shimmer" />
      <span className="text-[10px] font-medium efg-30">Generating...</span>
      <SkeletonLine width="32px" height="xs" shade="light" shimmer />
    </div>
  );
}

/* ── Action bar ──────────────────────────────────────────────────── */

function MockActionBar() {
  return (
    <div className="flex items-center gap-3 mt-2 ml-[44px]">
      <IconSlot icon={Download} size={12} className="efg-20 hover:efg-40 transition-colors" />
      <IconSlot icon={Maximize} size={12} className="efg-20" />
      <IconSlot icon={Film} size={12} className="efg-20" />
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

export function VideoGenerationIllustration() {
  return (
    <MockPanel showDots title="Video Generation" className="max-w-lg mx-auto">
      <div className="px-2 py-4 space-y-3">
        {/* User message */}
        <MockUserBubble />

        {/* Frame attachments */}
        <MockFrameThumbnails />
        <MockFramePair />

        <SkeletonDivider />

        {/* Video player */}
        <MockVideoPlayer />

        {/* Generation status */}
        <MockGenerationStatus />

        {/* Action bar */}
        <MockActionBar />
      </div>

      {/* Chat input */}
      <MockChatInput />
    </MockPanel>
  );
}
