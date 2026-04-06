import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Search, Sparkles, Copy, SquarePen, Trash2, Plus } from "lucide-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProGateWrapper } from "@/hooks/useProGate";
import { useVisibleSkills } from "@/hooks/useSharedData";
import { useToast } from "@/components/shared/Toast.context";
import { convexErrorMessage } from "@/lib/convexErrors";

// ─── Skill card ─────────────────────────────────────────────────────────────

interface SkillDoc {
  _id: Id<"skills">;
  name: string;
  summary?: string;
  ownerUserId?: string;
  status?: string;
  isSystem?: boolean;
}

function SkillCard({
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
  const isOwned = skill.ownerUserId === currentUserId;
  const isSystem = !skill.ownerUserId || skill.isSystem;

  return (
    <Link
      to={`/app/settings/skills/${skill._id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors"
    >
      {/* Icon */}
      <div className="w-7 h-7 flex items-center justify-center flex-shrink-0">
        <Sparkles size={20} className="text-accent" />
      </div>
      {/* Info */}
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
      {/* Actions */}
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

// ─── Page content ───────────────────────────────────────────────────────────

function SkillsPageContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const skills = useVisibleSkills();
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Id<"skills"> | null>(null);
  const { toast } = useToast();

  const deleteSkill = useMutation(api.skills.mutations.deleteSkill);
  const duplicateSkill = useMutation(api.skills.mutations.duplicateSystemSkill);

  async function handleDuplicate(id: Id<"skills">) {
    try {
      await duplicateSkill({ skillId: id });
      toast({ message: t("skill_duplicated"), variant: "success" });
    } catch (e) {
      toast({ message: convexErrorMessage(e, t("skill_duplicate_failed")), variant: "error" });
    }
  }

  async function handleDelete(id: Id<"skills">) {
    try {
      await deleteSkill({ skillId: id });
    } catch (e) {
      toast({ message: convexErrorMessage(e, t("skill_delete_failed")), variant: "error" });
    }
  }

  const filteredSkills: SkillDoc[] = ((skills ?? []) as SkillDoc[]).filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()),
  );

  const systemSkills = filteredSkills.filter((s) => s.isSystem || !s.ownerUserId);
  const userSkills = filteredSkills.filter((s) => !s.isSystem && s.ownerUserId);

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button
          onClick={() => navigate("/app/settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{t("skills_page_title")}</h1>
        <Link
          to="/app/settings/skills/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} strokeWidth={2.5} />
          {t("new_skill")}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input
              type="search"
              placeholder={t("search_skills_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
            />
          </div>

          {skills === undefined ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : (
            <>
              {/* User skills */}
              {userSkills.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-foreground/50 uppercase tracking-wide px-1">{t("your_skills_section")}</h3>
                  <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                    {userSkills.map((skill) => (
                      <SkillCard
                        key={skill._id}
                        skill={skill}
                        onDelete={(id) => setDeleteTarget(id)}
                        onDuplicate={(id) => void handleDuplicate(id)}
                        currentUserId={skill.ownerUserId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* System skills */}
              {systemSkills.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-foreground/50 uppercase tracking-wide px-1">{t("built_in_section")}</h3>
                  <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                    {systemSkills.map((skill) => (
                      <SkillCard
                        key={skill._id}
                        skill={skill}
                        onDelete={(id) => setDeleteTarget(id)}
                        onDuplicate={(id) => void handleDuplicate(id)}
                        currentUserId={skill.ownerUserId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredSkills.length === 0 && (
                <div className="text-center py-12 space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                    <Sparkles size={28} strokeWidth={1.5} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{search ? t("no_matching_skills") : t("no_skills_yet")}</p>
                    <p className="text-xs text-foreground/50 mt-1">
                      {search ? t("skills_no_match_desc") : t("skills_empty_desc")}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <p className="text-xs text-muted px-1">
            {t("skills_page_footer")}
          </p>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        title={t("skills_delete_confirm_title")}
        description={t("skills_delete_confirm_message")}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
      />
    </div>
  );
}

export function SkillsPage() {
  return (
    <ProGateWrapper feature="Skills">
      <SkillsPageContent />
    </ProGateWrapper>
  );
}
