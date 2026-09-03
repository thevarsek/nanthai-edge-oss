import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, SquarePen, Trash2, Sparkles } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { statusBadgeClass } from "@/lib/uiTokens";
import {
  isMediaSkillUnavailable,
  mediaSkillUnavailableMessageKey,
} from "@/lib/mediaSkillAvailability";
import { isSystemSkill, type SkillDefaultState, type SkillDoc } from "./SkillsPage.helpers";

export function DefaultStateBadge({
  state,
  inherited,
  unavailable = false,
}: {
  state: Exclude<SkillDefaultState, undefined>;
  inherited: boolean;
  unavailable?: boolean;
}) {
  const { t } = useTranslation();
  if (unavailable) {
    return (
      <span className={statusBadgeClass("rejected", "border-0")}>
        {t("unavailable")}
      </span>
    );
  }
  const status = state === "always" ? "accepted" : state === "available" ? "running" : "rejected";
  const label = state === "always"
    ? t("skill_state_always")
    : state === "available"
      ? t("skill_state_available")
      : t("skill_state_blocked");
  return (
    <span className={statusBadgeClass(status, "border-0")}>
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
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors">
      <Link
        to={`/app/settings/skills/${skill._id}`}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch"
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
          {isMediaSkillUnavailable(skill) && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 line-clamp-2">
              {t(mediaSkillUnavailableMessageKey(skill))}
            </p>
          )}
        </div>
        <ChevronRight size={12} className="text-foreground/30 flex-shrink-0" />
      </Link>
      <div className="flex items-center gap-1 flex-shrink-0">
        {isSystem && (
          <button
            onClick={() => onDuplicate(skill._id)}
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
              className="p-1.5 rounded-lg text-foreground/50 hover:text-primary transition-colors"
              title={t("edit")}
            >
              <SquarePen size={14} />
            </Link>
            <button
              onClick={() => onDelete(skill._id)}
              className="p-1.5 rounded-lg text-foreground/50 hover:text-destructive transition-colors"
              title={t("delete")}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
