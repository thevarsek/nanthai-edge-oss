import {
  CalendarClock,
  Play,
  ChevronRight,
  Search,
  UserCircle,
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
/*  Automated Tasks Illustration                                       */
/*  Shows a task pipeline with steps + schedule indicator.              */
/* ------------------------------------------------------------------ */

function MockPipelineStep({
  number,
  model,
  color,
  hasSearch,
  hasPersona,
}: {
  number: number;
  model: string;
  color: string;
  hasSearch?: boolean;
  hasPersona?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(var(--edge-fg),0.08)] text-[9px] font-bold efg-35">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <MockProviderAvatar label={model[0]} color={color} size={18} />
          <SkeletonLine width="55px" height="xs" shade="medium" />
          {hasSearch && (
            <div className="flex items-center gap-0.5 rounded-full bg-[rgba(var(--edge-fg),0.05)] px-1.5 py-0.5">
              <IconSlot icon={Search} size={8} className="efg-25" />
              <span className="text-[7px] efg-25">Search</span>
            </div>
          )}
          {hasPersona && (
            <div className="flex items-center gap-0.5 rounded-full bg-[rgba(var(--edge-fg),0.05)] px-1.5 py-0.5">
              <IconSlot icon={UserCircle} size={8} className="efg-25" />
              <span className="text-[7px] efg-25">Persona</span>
            </div>
          )}
        </div>
        <SkeletonLine width="80%" height="xs" shade="light" />
      </div>
      <IconSlot icon={ChevronRight} size={10} className="efg-15 mt-1" />
    </div>
  );
}

export function AutomatedTasksIllustration() {
  return (
    <MockPanel showDots title="Scheduled Task" className="max-w-sm mx-auto">
      {/* Schedule badge */}
      <div className="flex items-center gap-2 rounded-lg bg-[rgba(var(--edge-fg),0.03)] border border-[rgba(var(--edge-fg),0.06)] px-3 py-2 mb-3">
        <IconSlot icon={CalendarClock} size={14} className="text-[var(--edge-cyan)]" />
        <span className="text-[10px] font-medium efg-45">Every weekday at 8:00 AM</span>
        <div className="ml-auto flex items-center gap-1">
          <AccentDot color="var(--edge-cyan)" size={6} />
          <span className="text-[9px] efg-30">Active</span>
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] px-3">
        <div className="flex items-center gap-1.5 pt-3 pb-1">
          <span className="text-[9px] font-semibold efg-30 uppercase tracking-wider">Pipeline · 3 steps</span>
        </div>

        <MockPipelineStep number={1} model="ChatGPT" color="var(--edge-cyan)" hasSearch />
        <SkeletonDivider />
        <MockPipelineStep number={2} model="Claude" color="var(--edge-coral)" hasPersona />
        <SkeletonDivider />
        <MockPipelineStep number={3} model="Gemini" color="var(--edge-amber)" />
      </div>

      {/* Run button */}
      <div className="flex justify-end mt-3">
        <div className="flex items-center gap-1.5 rounded-full bg-[var(--edge-cyan)] px-3 py-1.5">
          <IconSlot icon={Play} size={10} className="text-white" />
          <span className="text-[10px] font-semibold text-white">Run Now</span>
        </div>
      </div>
    </MockPanel>
  );
}
