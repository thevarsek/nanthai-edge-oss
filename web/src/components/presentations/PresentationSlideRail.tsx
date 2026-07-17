import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SlideFrame } from "./SlideFrame";
import type { PresentationSlideRecord } from "@/lib/presentations/types";

interface PresentationSlideRailProps {
  slides: PresentationSlideRecord[];
  activeSlideId: string;
  assetUrls: Record<string, string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (slideId: string) => void;
}

export function PresentationSlideRail({
  slides,
  activeSlideId,
  assetUrls,
  collapsed,
  onToggleCollapsed,
  onSelect,
}: PresentationSlideRailProps) {
  const toggleLabel = collapsed ? "Expand slide navigation" : "Collapse slide navigation";

  return (
    <nav
      className={`${collapsed ? "w-10" : "w-[112px]"} flex shrink-0 flex-col border-r border-border/40 bg-surface-2/25 transition-[width]`}
      aria-label="Slide navigation"
    >
      <div className="flex h-10 shrink-0 items-center justify-end border-b border-border/30 px-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      {!collapsed && (
        <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-3" aria-label="Slides">
          {slides.map((slide, index) => (
            <li key={slide.slideId}>
              <button
                type="button"
                onClick={() => onSelect(slide.slideId)}
                className={`w-full rounded-md p-1 text-left transition-colors ${slide.slideId === activeSlideId ? "bg-primary/10 ring-1 ring-primary/50" : "hover:bg-surface-3/60"}`}
                aria-label={`Open slide ${index + 1}: ${slide.title}`}
                aria-current={slide.slideId === activeSlideId ? "page" : undefined}
              >
                <div className="aspect-video overflow-hidden rounded-sm bg-black">
                  <SlideFrame slide={slide} assetUrls={assetUrls} className="pointer-events-none" />
                </div>
                <span className="mt-1 block truncate text-[10px] text-muted">
                  {index + 1}. {slide.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
