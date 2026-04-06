import { useState } from "react";
import { Info, PlusCircle, Move, Crosshair, X } from "lucide-react";

const CARDS = [
  {
    title: "Focus First",
    body: "Click a card to move the active branch. The branch highlight helps you navigate while shared history stays deduped.",
    tint: "text-orange-400 border-orange-400/40 bg-orange-400/10",
    icon: Crosshair,
  },
  {
    title: "Add Explicit Context",
    body: "Use the + button on cards when you want multiple nodes in the prompt. Shared ancestors are merged automatically.",
    tint: "text-[--nanth-primary] border-[--nanth-primary]/40 bg-[--nanth-primary]/10",
    icon: PlusCircle,
  },
  {
    title: "Move Without Losing Structure",
    body: "Drag cards freely. Connectors stay attached to the live position so the canvas remains readable while you reorganize ideas.",
    tint: "text-[--nanth-primary] border-[--nanth-primary]/40 bg-[--nanth-primary]/10",
    icon: Move,
  },
];

export function IdeascapeHelpDeck({ onDismiss }: { onDismiss: () => void }) {
  const [selection, setSelection] = useState(0);
  const card = CARDS[selection];
  const Icon = card.icon;

  return (
    <div className="absolute right-4 bottom-20 z-20 w-[380px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/10 bg-surface-1/95 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.28)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Info size={16} className="text-[--nanth-primary]" />
        <h2 className="text-sm font-semibold flex-1">How Ideascapes Work</h2>
        <button onClick={onDismiss} className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-2">
          <X size={16} />
        </button>
      </div>

      <div className={`rounded-2xl border p-4 min-h-[220px] ${card.tint}`}>
        <div className="h-36 rounded-2xl mb-4 flex items-center justify-center bg-gradient-to-br from-white/10 to-black/10 relative overflow-hidden">
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_45%)]" />
          <div className="relative flex items-center gap-4">
            <div className="w-20 h-12 rounded-2xl border border-current/30 bg-surface-1/80" />
            <div className="w-24 h-14 rounded-2xl border-2 border-current bg-surface-1/90 flex items-center justify-center">
              <Icon size={22} />
            </div>
            <div className="w-20 h-12 rounded-2xl border border-current/30 bg-surface-1/80" />
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">{card.title}</h3>
          <p className="text-sm text-muted leading-relaxed">{card.body}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <div className="flex items-center gap-2 flex-1">
          {CARDS.map((_, index) => (
            <button
              key={index}
              onClick={() => setSelection(index)}
              className={`h-2 rounded-full transition-all ${index === selection ? "w-5 bg-[--nanth-primary]" : "w-2 bg-white/20"}`}
              aria-label={`Go to help card ${index + 1}`}
            />
          ))}
        </div>
        <button
          onClick={() => selection === CARDS.length - 1 ? onDismiss() : setSelection((s) => s + 1)}
          className="text-xs font-semibold text-[--nanth-primary] hover:opacity-80"
        >
          {selection === CARDS.length - 1 ? "Done" : "Next"}
        </button>
      </div>

      <div className="mt-3 text-[11px] text-muted">
        Replay this anytime from the info button.
      </div>
    </div>
  );
}
