import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, SquarePen, Trash2, Sparkles } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { isSystemSkill, type SkillDefaultState, type SkillDoc } from "./SkillsPage.helpers";

export function DefaultStateBadge({
  state,
  inherited,
}: {
  state: Exclude<SkillDefaultState, undefined>;
  inherited: boolean;
}) {
  const { t } = useTranslation();
  const className =
    state === "always"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : state === "available"
        ? "bg-primary/15 text-primary"
        : "bg-red-500/15 text-red-600 dark:text-red-400";
  const label = state === "always"
    ? t("skill_state_always")
    : state === "available"
      ? t("skill_state_available")
      : t("skill_state_blocked");
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${className}`}>
      {inherited ? t("skill_state_default_badge", { state: label }) : label}
    </span>
  );
}

export function SkillCard({
  skill,
  onDelete,
  onDuplicate,
  currentUserId,
}: {
  skill: SkillDoc;
  onDelete: (id: Id<"skills">) => void;
  onDuplicate: (id: Id<"skills">) => void;
  currentUserId?: string;
}) {
  const { t } = useTranslation();
  const isSystem = isSystemSkill(skill);
  const isOwned = !isSystem && skill.ownerUserId === currentUserId;

  return (
    <Link
      to={`/app/settings/skills/${skill._id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors"
    >
      <div className="w-7 h-7 flex items-center justify-center flex-shrink-0">
        <Sparkles size={20} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate">{skill.name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 text-foreground/50 flex-shrink-0">
            {isSystem ? t("skill_built_in_badge") : t("skill_custom_badge")}
          </span>
        </div>
        {skill.summary && (
          <p className="text-xs text-foreground/50 mt-0.5 line-clamp-2">{skill.summary}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {isSystem && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(skill._id); }}
            className="p-1.5 rounded-lg text-foreground/50 hover:text-primary transition-colors"
            title={t("skill_duplicate_title")}
          >
            <Copy size={14} />
          </button>
        )}
        {isOwned && (
          <>
            <Link
              to={`/app/settings/skills/${skill._id}/edit`}
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg text-foreground/50 hover:text-primary transition-colors"
              title={t("edit")}
            >
              <SquarePen size={14} />
            </Link>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(skill._id); }}
              className="p-1.5 rounded-lg text-foreground/50 hover:text-red-400 transition-colors"
              title={t("delete")}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
        <ChevronRight size={12} className="text-foreground/30" />
      </div>
    </Link>
  );
}
