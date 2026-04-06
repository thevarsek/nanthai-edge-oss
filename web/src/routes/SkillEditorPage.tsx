import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Check } from "lucide-react";
import { ProGateWrapper } from "@/hooks/useProGate";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { SkillEditorMetadataSection } from "./SkillEditorMetadataSection";
import {
  cloneSkillMetadataSelection,
  emptySkillMetadataSelection,
  inferSkillMetadataSelection,
  requiredCapabilitiesForSkill,
  requiredToolProfilesForSkill,
  skillMetadataSelectionFromSkill,
  skillSelectionEquals,
  type SkillMetadataSelection,
} from "./SkillMetadataSelection";

// ─── Types ─────────────────────────────────────────────────────────────────

type RuntimeMode = "textOnly" | "toolAugmented" | "sandboxAugmented";

interface SkillFormState {
  name: string;
  summary: string;
  instructionsRaw: string;
  runtimeMode: RuntimeMode;
  metadataSelection: SkillMetadataSelection;
}

// ─── Page content ───────────────────────────────────────────────────────────

function SkillEditorPageContent() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { skillId } = useParams<{ skillId?: string }>();
  const isEditing = !!skillId;

  const existingSkill = useQuery(
    api.skills.queries.getSkillDetail,
    skillId ? { skillId: skillId as Id<"skills"> } : "skip",
  );

  const createSkill = useMutation(api.skills.mutations.createSkill);
  const updateSkill = useMutation(api.skills.mutations.updateSkill);

  const [form, setForm] = useState<SkillFormState>({
    name: "",
    summary: "",
    instructionsRaw: "",
    runtimeMode: "toolAugmented",
    metadataSelection: emptySkillMetadataSelection(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadataTouchedRef = useRef(false);

  // Populate form when editing existing skill
  useEffect(() => {
    if (existingSkill) {
      setForm({
        name: existingSkill.name,
        summary: existingSkill.summary ?? "",
        instructionsRaw: existingSkill.instructionsRaw ?? "",
        runtimeMode: (existingSkill.runtimeMode as RuntimeMode | undefined) ?? "toolAugmented",
        metadataSelection: skillMetadataSelectionFromSkill(existingSkill),
      });
      metadataTouchedRef.current = true;
    }
  }, [existingSkill]);

  useEffect(() => {
    if (isEditing || metadataTouchedRef.current) return;
    setForm((current) => {
      const inferred = inferSkillMetadataSelection(current.summary, current.instructionsRaw);
      if (skillSelectionEquals(current.metadataSelection, inferred)) {
        return current;
      }
      return { ...current, metadataSelection: inferred };
    });
  }, [form.instructionsRaw, form.summary, isEditing]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.instructionsRaw.trim()) {
      setError(t("skill_name_required"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEditing && skillId) {
        await updateSkill({
          skillId: skillId as Id<"skills">,
          name: form.name,
          summary: form.summary,
          instructionsRaw: form.instructionsRaw,
          runtimeMode: form.runtimeMode,
          requiredToolProfiles: requiredToolProfilesForSkill(form.metadataSelection),
          requiredCapabilities: requiredCapabilitiesForSkill(form.metadataSelection),
          requiredIntegrationIds: Array.from(form.metadataSelection.selectedIntegrationIds).sort(),
        });
      } else {
        await createSkill({
          name: form.name,
          summary: form.summary,
          instructionsRaw: form.instructionsRaw,
          runtimeMode: form.runtimeMode,
          requiredToolProfiles: requiredToolProfilesForSkill(form.metadataSelection),
          requiredCapabilities: requiredCapabilitiesForSkill(form.metadataSelection),
          requiredIntegrationIds: Array.from(form.metadataSelection.selectedIntegrationIds).sort(),
        });
      }
      navigate("/app/settings/skills");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skill_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  if (isEditing && existingSkill === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  // Runtime mode options — matching iOS naming (Workspace Runtime, not Sandbox Augmented)
  const runtimeOptions: { value: RuntimeMode; label: string; description: string }[] = [
    {
      value: "toolAugmented",
      label: t("skill_runtime_tool_augmented_label"),
      description: t("skill_runtime_tool_augmented_desc"),
    },
    {
      value: "textOnly",
      label: t("skill_runtime_text_only_label"),
      description: t("skill_runtime_text_only_desc"),
    },
    {
      value: "sandboxAugmented",
      label: t("skill_runtime_workspace_label"),
      description: t("skill_runtime_workspace_desc"),
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button
          onClick={() => navigate("/app/settings/skills")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">
          {isEditing ? t("edit_skill") : t("new_skill")}
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-400/10 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("skill_name_label")}</label>
            <input
              type="text"
              placeholder={t("skill_name_placeholder")}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Summary */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">
              {t("skill_summary_label")} <span className="text-foreground/30 normal-case">{t("skill_summary_optional_label")}</span>
            </label>
            <input
              type="text"
              placeholder={t("skill_summary_placeholder")}
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("skill_instructions_label")}</label>
            <textarea
              placeholder={t("skill_instructions_placeholder")}
              value={form.instructionsRaw}
              onChange={(e) => setForm((f) => ({ ...f, instructionsRaw: e.target.value }))}
              rows={12}
              className="w-full px-3 py-2.5 rounded-xl bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent resize-none font-mono"
            />
          </div>

          {/* Runtime mode */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("skill_runtime_mode_label")}</label>
            <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
              {runtimeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setForm((f) => ({ ...f, runtimeMode: opt.value }))}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{opt.label}</p>
                    <p className="text-xs text-foreground/50 mt-0.5">{opt.description}</p>
                  </div>
                  {form.runtimeMode === opt.value && (
                    <Check size={16} strokeWidth={2.5} className="text-accent flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted px-1">
              {t("skill_runtime_footer")}
            </p>
          </div>

          <SkillEditorMetadataSection
            selection={form.metadataSelection}
            onChange={(metadataSelection) => {
              metadataTouchedRef.current = true;
              setForm((current) => ({
                ...current,
                metadataSelection: cloneSkillMetadataSelection(metadataSelection),
              }));
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function SkillEditorPage() {
  return (
    <ProGateWrapper feature="Skills">
      <SkillEditorPageContent />
    </ProGateWrapper>
  );
}
