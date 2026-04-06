import { type Id } from "@convex/_generated/dataModel";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PersonaCardData {
  _id: Id<"personas">;
  displayName: string;
  personaDescription?: string;
  avatarEmoji?: string;
  avatarImageUrl?: string;
  avatarColor?: string;
  isDefault?: boolean;
  modelId?: string;
  systemPrompt: string;
}

interface PersonaCardProps {
  persona: PersonaCardData;
  view: "grid" | "list";
  onEdit: (id: Id<"personas">) => void;
  onDelete: (id: Id<"personas">) => void;
  onNewChat: (id: Id<"personas">) => void;
}

// ── Avatar ─────────────────────────────────────────────────────────────────

function AvatarDisplay({
  persona,
  size,
}: {
  persona: Pick<PersonaCardData, "avatarImageUrl" | "avatarEmoji" | "avatarColor" | "displayName">;
  size: "sm" | "md";
}) {
  const dim = size === "md" ? "w-11 h-11 text-xl" : "w-9 h-9 text-lg";
  const bg = persona.avatarColor ?? "#6366f1";

  if (persona.avatarImageUrl) {
    return (
      <img
        src={persona.avatarImageUrl}
        alt={persona.displayName}
        className={`${dim} rounded-xl object-cover flex-shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${dim} rounded-xl flex items-center justify-center flex-shrink-0`}
      style={{ backgroundColor: bg }}
    >
      {persona.avatarEmoji ? (
        <span>{persona.avatarEmoji}</span>
      ) : (
        <span className="text-white font-semibold">
          {persona.displayName.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

// ── Subtitle text (description or truncated prompt) ────────────────────────

function Subtitle({ persona }: { persona: PersonaCardData }) {
  const text = persona.personaDescription || persona.systemPrompt;
  if (!text) return null;
  return (
    <p className="text-xs text-secondary line-clamp-2 leading-relaxed">
      {text}
    </p>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

export function PersonaCard({ persona, view, onEdit, onDelete, onNewChat }: PersonaCardProps) {
  if (view === "list") {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-2 transition-colors group">
        <AvatarDisplay persona={persona} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{persona.displayName}</span>
            {persona.isDefault && (
              <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full flex-shrink-0">
                Default
              </span>
            )}
          </div>
          {persona.personaDescription && (
            <p className="text-xs text-secondary truncate mt-0.5">{persona.personaDescription}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onNewChat(persona._id)}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-primary transition-colors"
            title="New chat"
          >
            <MessageSquare size={14} />
          </button>
          <button
            onClick={() => onEdit(persona._id)}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-primary transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(persona._id)}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  }

  // ── Grid view — compact horizontal card ────────────────────────────────
  return (
    <div className="group rounded-2xl bg-surface-2 overflow-hidden transition-colors hover:bg-surface-3">
      {/* Main content — horizontal layout */}
      <div className="flex items-start gap-3 p-3.5">
        <AvatarDisplay persona={persona} size="md" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{persona.displayName}</h3>
            {persona.isDefault && (
              <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full flex-shrink-0">
                Default
              </span>
            )}
          </div>
          <Subtitle persona={persona} />
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-1.5 px-3.5 pb-3 pt-0">
        <button
          onClick={() => onNewChat(persona._id)}
          className="flex-1 text-xs py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors font-medium"
        >
          New Chat
        </button>
        <button
          onClick={() => onEdit(persona._id)}
          className="p-1.5 rounded-lg hover:bg-surface-1 text-muted hover:text-primary transition-colors"
          title="Edit"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onDelete(persona._id)}
          className="p-1.5 rounded-lg hover:bg-surface-1 text-muted hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
