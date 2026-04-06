import {
  FolderOpen,
  Search,
  MoreHorizontal,
  MessageSquare,
  FolderPlus,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  IconSlot,
  AccentDot,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Folders Illustration                                               */
/*  Shows a sidebar with coloured folders, chat items inside a folder, */
/*  and a search bar.                                                  */
/* ------------------------------------------------------------------ */

function MockFolderRow({
  name,
  color,
  count,
  active,
}: {
  name: string;
  color: string;
  count: number;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
        active
          ? "bg-[rgba(var(--edge-fg),0.06)]"
          : "hover:bg-[rgba(var(--edge-fg),0.03)]"
      }`}
    >
      <FolderOpen size={14} style={{ color }} className="shrink-0" />
      <span className="text-[11px] font-medium efg-60 flex-1">{name}</span>
      <span className="text-[9px] efg-25">{count}</span>
    </div>
  );
}

function MockChatRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-[rgba(var(--edge-fg),0.03)]">
      <IconSlot icon={MessageSquare} size={12} className="efg-20 shrink-0" />
      <SkeletonLine width={width} height="sm" shade="light" />
      <IconSlot icon={MoreHorizontal} size={12} className="efg-15 ml-auto shrink-0" />
    </div>
  );
}

export function FoldersIllustration() {
  return (
    <MockPanel showDots title="Conversations" className="max-w-sm mx-auto">
      {/* Search bar */}
      <div className="flex items-center gap-2 rounded-lg border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] px-2.5 py-2 mb-3">
        <IconSlot icon={Search} size={12} className="efg-25" />
        <SkeletonLine width="40%" height="xs" shade="light" />
      </div>

      {/* Folders */}
      <div className="space-y-0.5 mb-2">
        <MockFolderRow name="Work" color="var(--edge-cyan)" count={12} active />
        <MockFolderRow name="Personal" color="var(--edge-coral)" count={8} />
        <MockFolderRow name="Research" color="var(--edge-amber)" count={5} />
      </div>

      {/* New folder button */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 mb-1">
        <IconSlot icon={FolderPlus} size={12} className="efg-20" />
        <span className="text-[10px] efg-25">New Folder</span>
      </div>

      {/* System folder — always at the bottom */}
      <div className="space-y-0.5 mb-3">
        <MockFolderRow name="Scheduled" color="var(--edge-fg-40, rgba(var(--edge-fg),0.4))" count={3} />
      </div>

      <SkeletonDivider />

      {/* Chats inside active folder */}
      <div className="mt-2">
        <div className="flex items-center gap-1.5 px-2.5 mb-1.5">
          <AccentDot color="var(--edge-cyan)" size={5} />
          <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider">Work</span>
        </div>
        <div className="space-y-0.5">
          <MockChatRow width="70%" />
          <MockChatRow width="55%" />
          <MockChatRow width="80%" />
          <MockChatRow width="45%" />
        </div>
      </div>
    </MockPanel>
  );
}
