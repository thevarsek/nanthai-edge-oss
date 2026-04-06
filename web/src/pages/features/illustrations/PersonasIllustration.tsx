import {
  UserCircle,
} from "lucide-react";
import {
  MockPanel,
  MockProviderAvatar,
  IconSlot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Personas Illustration                                              */
/*  Shows persona cards with avatar, model, and personality traits.    */
/* ------------------------------------------------------------------ */

function MockPersonaCard({
  emoji,
  name,
  model,
  modelColor,
  traits,
  active,
}: {
  emoji: string;
  name: string;
  model: string;
  modelColor: string;
  traits: string[];
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 transition-colors ${
        active
          ? "border-[var(--edge-coral)]/30 bg-[var(--edge-coral)]/5"
          : "border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)]"
      }`}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(var(--edge-fg),0.06)] text-base">
          {emoji}
        </div>
        <div>
          <div className="text-[11px] font-semibold efg-70">{name}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <MockProviderAvatar label={model[0]} color={modelColor} size={14} />
            <span className="text-[9px] efg-30">{model}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {traits.map((t, i) => (
          <span
            key={i}
            className="rounded-full bg-[rgba(var(--edge-fg),0.05)] px-2 py-0.5 text-[8px] font-medium efg-35"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PersonasIllustration() {
  return (
    <MockPanel showDots title="Personas" className="max-w-sm mx-auto">
      <div className="space-y-2.5">
        <MockPersonaCard
          emoji="🧑‍💻"
          name="Code Reviewer"
          model="Claude"
          modelColor="var(--edge-coral)"
          traits={["Precise", "Security-focused", "TypeScript"]}
          active
        />
        <MockPersonaCard
          emoji="✍️"
          name="Writing Coach"
          model="ChatGPT"
          modelColor="var(--edge-cyan)"
          traits={["Encouraging", "Concise", "AP Style"]}
        />
        <MockPersonaCard
          emoji="📊"
          name="Data Analyst"
          model="Gemini"
          modelColor="var(--edge-amber)"
          traits={["Structured", "Charts", "SQL"]}
        />
      </div>

      {/* Create button */}
      <div className="flex items-center gap-2 mt-3 rounded-xl border border-dashed border-[rgba(var(--edge-fg),0.10)] px-3.5 py-3 efg-25 hover:efg-40 transition-colors">
        <IconSlot icon={UserCircle} size={16} />
        <span className="text-[11px] font-medium">Create new persona</span>
      </div>
    </MockPanel>
  );
}
