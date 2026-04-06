// routes/SkillDetailPage.tsx
// Read-only detail view for a skill, matching iOS SkillDetailView.swift.
// 7 sections: Identity, Summary, Instructions, Requirements, Warnings, Details, Actions.

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  ChevronLeft, Copy, SquarePen, Trash2,
  Terminal, Wrench, AlignLeft, AlertTriangle,
} from "lucide-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProGateWrapper } from "@/hooks/useProGate";
import { useVisibleSkills } from "@/hooks/useSharedData";
import { useToast } from "@/components/shared/Toast.context";
import { convexErrorMessage } from "@/lib/convexErrors";

// ─── Helpers ────────────────────────────────────────────────────────────────

function RuntimeModeIcon({ mode, size = 14 }: { mode: string; size?: number }) {
  if (mode === "sandboxAugmented") return <Terminal size={size} />;
  if (mode === "toolAugmented") return <Wrench size={size} />;
  return <AlignLeft size={size} />;
}

function runtimeModeLabel(mode: string, t: (key: string) => string): string {
  if (mode === "toolAugmented") return t("runtime_tool_augmented");
  if (mode === "sandboxAugmented") return t("runtime_workspace");
  return t("runtime_text_only");
}

function sourceBadge(skill: SkillFull, t: (key: string) => string): string {
  switch (skill.origin) {
    case "anthropicCurated": return t("skill_origin_builtin");
    case "nanthaiBuiltin": return t("skill_origin_system");
    case "userAuthored": return t("skill_origin_custom");
    case "assistantAuthored": return t("skill_origin_ai_created");
    default: return t("skill_origin_skill");
  }
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ─── Types (matches Convex schema) ──────────────────────────────────────────

interface SkillFull {
  _id: Id<"skills">;
  slug: string;
  name: string;
  summary: string;
  instructionsRaw: string;
  compilationStatus: string;
  scope: string;
  ownerUserId?: string;
  origin: string;
  visibility: string;
  lockState: string;
  status: string;
  runtimeMode: string;
  requiredToolIds: string[];
  requiredToolProfiles?: string[];
  requiredIntegrationIds: string[];
  requiredCapabilities?: string[];
  unsupportedCapabilityCodes: string[];
  validationWarnings: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Detail row ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm text-foreground/70">{value}</span>
    </div>
  );
}

// ─── Page content ───────────────────────────────────────────────────────────

function SkillDetailContent() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const skills = useVisibleSkills();
  const [showDelete, setShowDelete] = useState(false);
  const { toast } = useToast();

  const deleteSkill = useMutation(api.skills.mutations.deleteSkill);
  const duplicateSkill = useMutation(api.skills.mutations.duplicateSystemSkill);

  // Try shared data first (already loaded), fall back to direct query
  const sharedSkill = (skills ?? []).find(
    (s) => (s._id as string) === skillId,
  ) as SkillFull | undefined;

  const queriedSkill = useQuery(
    api.skills.queries.getSkillDetail,
    sharedSkill ? "skip" : skillId ? { skillId: skillId as Id<"skills"> } : "skip",
  ) as SkillFull | null | undefined;

  const skill = sharedSkill ?? queriedSkill;

  if (skill === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (skill === null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted">{t("skill_not_found")}</p>
        <button
          onClick={() => navigate("/app/settings/skills")}
          className="text-sm text-accent hover:underline"
        >
          {t("back_to_skills")}
        </button>
      </div>
    );
  }

  const isSystem = skill.scope === "system";
  const isUser = skill.scope === "user";
  const isEditable = skill.lockState === "editable";
  const requiredCapabilities = skill.requiredCapabilities ?? [];
  const requiredProfiles = skill.requiredToolProfiles ?? [];
  const hasRequirements =
    skill.requiredToolIds.length > 0 ||
    requiredProfiles.length > 0 ||
    skill.requiredIntegrationIds.length > 0 ||
    requiredCapabilities.length > 0;

  async function handleDuplicate() {
    try {
      await duplicateSkill({ skillId: skill!._id });
      navigate("/app/settings/skills");
    } catch (e) {
      toast({ message: convexErrorMessage(e, t("skill_duplicate_failed")), variant: "error" });
    }
  }

  async function handleDelete() {
    try {
      await deleteSkill({ skillId: skill!._id });
      navigate("/app/settings/skills");
    } catch (e) {
      toast({ message: convexErrorMessage(e, t("skill_delete_failed")), variant: "error" });
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button
          onClick={() => navigate("/app/settings/skills")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1 truncate">{skill.name}</h1>
        <div className="flex items-center gap-1">
          {isSystem && (
            <button
              onClick={() => void handleDuplicate()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-accent hover:bg-accent/10 transition-colors"
              title={t("skill_duplicate_to_custom")}
            >
              <Copy size={14} />
              <span className="hidden sm:inline">{t("duplicate")}</span>
            </button>
          )}
          {isUser && isEditable && (
            <Link
              to={`/app/settings/skills/${skill._id}/edit`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-accent hover:bg-accent/10 transition-colors"
            >
              <SquarePen size={14} />
              <span className="hidden sm:inline">{t("edit")}</span>
            </Link>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">

          {/* ── 1. Identity ── */}
          <SectionLabel>{t("skill_section_label")}</SectionLabel>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            <DetailRow label={t("detail_name")} value={skill.name} />
            <DetailRow label={t("detail_type")} value={sourceBadge(skill, t)} />
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-muted">{t("detail_mode")}</span>
              <div className="flex items-center gap-1.5 text-sm text-foreground/70">
                <RuntimeModeIcon mode={skill.runtimeMode} />
                {runtimeModeLabel(skill.runtimeMode, t)}
              </div>
            </div>
          </div>

          {/* ── 2. Summary ── */}
          <SectionLabel>{t("summary_section")}</SectionLabel>
          <div className="rounded-2xl bg-surface-2 overflow-hidden">
            <p className="px-4 py-3 text-sm leading-relaxed">{skill.summary}</p>
          </div>

          {/* ── 3. Instructions ── */}
          <SectionLabel>{t("instructions_section")}</SectionLabel>
          <div className="rounded-2xl bg-surface-2 overflow-hidden">
            <pre className="px-4 py-3 text-xs font-mono text-foreground/80 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto select-text">
              {skill.instructionsRaw}
            </pre>
          </div>

          {/* ── 4. Requirements ── */}
          {hasRequirements && (
            <>
              <SectionLabel>{t("requirements_section")}</SectionLabel>
              <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                {requiredProfiles.length > 0 && (
                  <DetailRow label={t("detail_profiles")} value={requiredProfiles.join(", ")} />
                )}
                {skill.requiredToolIds.length > 0 && (
                  <DetailRow label={t("detail_tools")} value={skill.requiredToolIds.join(", ")} />
                )}
                {skill.requiredIntegrationIds.length > 0 && (
                  <DetailRow label={t("detail_integrations")} value={skill.requiredIntegrationIds.join(", ")} />
                )}
                {requiredCapabilities.length > 0 && (
                  <DetailRow label={t("detail_capabilities")} value={requiredCapabilities.join(", ")} />
                )}
              </div>
            </>
          )}

          {/* ── 5. Warnings ── */}
          {skill.validationWarnings.length > 0 && (
            <>
              <SectionLabel>{t("warnings_section")}</SectionLabel>
              <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                {skill.validationWarnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-4 py-2.5">
                    <AlertTriangle size={14} className="text-orange-400 flex-shrink-0" />
                    <span className="text-sm text-orange-400">{w}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 6. Details (metadata) ── */}
          <SectionLabel>{t("details_section")}</SectionLabel>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            <DetailRow label={t("detail_version")} value={`v${Math.floor(skill.version)}`} />
            <DetailRow label={t("detail_created")} value={formatDate(skill.createdAt)} />
            <DetailRow label={t("detail_updated")} value={formatDate(skill.updatedAt)} />
          </div>

          {/* ── 7. Actions ── */}
          {isSystem && (
            <>
              <div className="rounded-2xl bg-surface-2 overflow-hidden">
                <button
                  onClick={() => void handleDuplicate()}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-accent hover:bg-surface-3 transition-colors"
                >
                  <Copy size={16} />
                  {t("skill_duplicate_to_custom")}
                </button>
              </div>
              <p className="text-xs text-muted px-1">
                {t("skill_detail_footer")}
              </p>
            </>
          )}

          {isUser && (
            <div className="rounded-2xl bg-surface-2 overflow-hidden">
              <button
                onClick={() => setShowDelete(true)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={16} />
                {t("delete_skill")}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => void handleDelete()}
        title={t("delete_skill_question")}
        description={t("delete_skill_permanently", { name: skill.name })}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">
      {children}
    </h3>
  );
}

export function SkillDetailPage() {
  return (
    <ProGateWrapper feature="Skills">
      <SkillDetailContent />
    </ProGateWrapper>
  );
}
