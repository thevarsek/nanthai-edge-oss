import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import { Toggle } from "@/components/shared/Toggle";
import { IntegrationLogo } from "@/components/shared/IntegrationLogo";
import { AlignLeft, Wrench, Terminal } from "lucide-react";
import type { SkillOverrideState } from "./PersonaEditorForm";

// ── Emoji picker (simple grid) ─────────────────────────────────────────────

const COMMON_EMOJIS = [
  "🤖", "🧠", "💡", "⚡", "🔥", "🎯", "🦁", "🦊", "🐉", "🦅",
  "🧙", "🧑‍💻", "👨‍🔬", "👩‍🎨", "🕵️", "🧑‍🏫", "👨‍⚕️", "🧑‍💼", "👨‍🍳", "🧑‍🚀",
  "✨", "🌟", "💎", "🎭", "🎨", "📚", "🔬", "🏆", "🎵", "🌊",
];

interface EmojiPickerProps {
  value?: string;
  onChange: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ value, onChange, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 z-50 bg-surface-1 border border-border rounded-xl p-2 shadow-xl"
    >
      <div className="grid grid-cols-10 gap-1">
        {COMMON_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => { onChange(emoji); onClose(); }}
            className={`w-8 h-8 text-lg rounded-lg hover:bg-surface-3 transition-colors flex items-center justify-center ${value === emoji ? "bg-accent/20 ring-1 ring-accent" : ""}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Skill row (with toggle, mirrors iOS skillToggle) ───────────────────────

interface SkillRowProps {
  skill: { _id: Id<"skills">; name: string; summary?: string; scope?: string; runtimeMode?: string };
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function RuntimeModeIcon({ mode }: { mode?: string }) {
  if (mode === "sandboxAugmented") return <Terminal size={16} className="text-primary" />;
  if (mode === "toolAugmented") return <Wrench size={16} className="text-primary" />;
  return <AlignLeft size={16} className="text-primary" />;
}

export function SkillRow({ skill, selected, onToggle, disabled = false }: SkillRowProps) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="w-5 flex items-center justify-center flex-shrink-0">
        <RuntimeModeIcon mode={skill.runtimeMode} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">{skill.name}</p>
        {skill.summary && (
          <p className="text-xs text-muted truncate mt-0.5">{skill.summary}</p>
        )}
      </div>
      <Toggle checked={selected} onChange={onToggle} disabled={disabled} />
    </div>
  );
}

const SKILL_STATE_CONFIG: Record<SkillOverrideState, { labelKey: string; className: string }> = {
  always: { labelKey: "skill_state_always", className: "bg-green-500/15 text-green-600 dark:text-green-400" },
  available: { labelKey: "skill_state_available", className: "bg-primary/15 text-primary" },
  never: { labelKey: "skill_state_blocked", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

interface SkillOverrideRowProps {
  skill: { _id: Id<"skills">; name: string; summary?: string; scope?: string; runtimeMode?: string };
  state: SkillOverrideState | undefined;
  onCycle: () => void;
  disabled?: boolean;
}

export function SkillOverrideRow({ skill, state, onCycle, disabled = false }: SkillOverrideRowProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-surface-3"}`}
    >
      <div className="w-5 flex items-center justify-center flex-shrink-0">
        <RuntimeModeIcon mode={skill.runtimeMode} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">{skill.name}</p>
        {skill.summary && (
          <p className="text-xs text-muted truncate mt-0.5">{skill.summary}</p>
        )}
      </div>
      {state ? (
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SKILL_STATE_CONFIG[state].className}`}>
          {t(SKILL_STATE_CONFIG[state].labelKey)}
        </span>
      ) : (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-3 text-muted font-medium">
          {t("skill_state_inherit")}
        </span>
      )}
    </button>
  );
}

// ── Integration toggle row ─────────────────────────────────────────────────

interface IntegrationRowProps {
  slug: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function IntegrationRow({ slug, label, checked, onChange }: IntegrationRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <IntegrationLogo slug={slug} size={22} className="flex-shrink-0" />
      <span className="flex-1 text-sm">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
