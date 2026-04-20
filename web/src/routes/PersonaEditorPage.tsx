import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { type Id } from "@convex/_generated/dataModel";
import { useConnectedAccounts, useVisibleSkills, useModelSummaries } from "@/hooks/useSharedData";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ModelPicker } from "@/components/shared/ModelPicker";
import { Toggle } from "@/components/shared/Toggle";
import { SettingsSection } from "@/components/settings/SettingsHelpers";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { connectProviderWithPopup } from "@/lib/providerOAuth";
import { convexErrorMessage } from "@/lib/convexErrors";
import {
  EmojiPicker,
  SkillOverrideRow,
  IntegrationRow,
} from "./PersonaEditorHelpers";
import {
  cycleSkillOverride,
  defaultForm,
  integrationSetToArray,
  type FormState,
  type IntegrationKey,
  type SkillOverrideState,
} from "./PersonaEditorForm";

export function PersonaEditorPage() {
  const { t } = useTranslation();
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useNavigate();
  const isNew = !personaId || personaId === "new";

  const skills = useVisibleSkills();
  const { googleConnection, microsoftConnection, notionConnection, slackConnection, appleCalendarConnection, clozeConnection } = useConnectedAccounts();
  const existingPersona = useQuery(
    api.personas.queries.get,
    isNew ? "skip" : { personaId: personaId as Id<"personas"> },
  );

  const createPersona = useMutation(api.personas.mutations.create);
  const updatePersona = useMutation(api.personas.mutations.update);
  const setPersonaSkillOverrides = useMutation(api.skills.mutations.setPersonaSkillOverrides);
  const setPersonaIntegrationOverrides = useMutation(api.skills.mutations.setPersonaIntegrationOverrides);
  const createUploadUrl = useMutation(api.chat.mutations.createUploadUrl);

  const [form, setForm] = useState<FormState>(defaultForm);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [didLoad, setDidLoad] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelSummaries = useModelSummaries();

  // ── Tool-capability validation ─────────────────────────────────────────
  const toolCapabilityError = useMemo(() => {
    const hasToolFeatures = integrationSetToArray(form.enabledIntegrations).length > 0 || form.selectedSkillIds.size > 0;
    if (!hasToolFeatures) return null;
    if (!form.modelId.trim()) return t("persona_choose_tool_model");
    if (!modelSummaries) return null; // still loading
    const summary = modelSummaries.find((m) => m.modelId === form.modelId);
    if (!summary) return t("persona_model_unverified_tools");
    if (!summary.supportsTools) return t("persona_model_no_tools");
    return null;
  }, [form.enabledIntegrations, form.selectedSkillIds, form.modelId, modelSummaries, t]);

  // ── Load existing persona into form ────────────────────────────────────
  useEffect(() => {
    if (didLoad || isNew) return;
    if (existingPersona === undefined) return;
    if (existingPersona === null) { navigate("/app/personas"); return; }
    const skillOverrides = new Map<string, SkillOverrideState>(
      ((existingPersona as { skillOverrides?: Array<{ skillId: Id<"skills">; state: SkillOverrideState }> }).skillOverrides
        ?? [])
        .map((entry) => [entry.skillId, entry.state]),
    );
    const integrationOverrides = new Map<string, boolean>(
      ((existingPersona as { integrationOverrides?: Array<{ integrationId: string; enabled: boolean }> }).integrationOverrides
        ?? [])
        .map((entry) => [entry.integrationId, entry.enabled]),
    );
    const selectedSkillIds = new Set(
      Array.from(skillOverrides.entries())
        .filter(([, state]) => state === "available" || state === "always")
        .map(([skillId]) => skillId as Id<"skills">),
    );
    const enabledIntegrations = new Set(
      Array.from(integrationOverrides.entries())
        .filter(([, enabled]) => enabled)
        .map(([integrationId]) => integrationId as IntegrationKey),
    );
    setForm({
      displayName: existingPersona.displayName,
      personaDescription: existingPersona.personaDescription ?? "",
      systemPrompt: existingPersona.systemPrompt,
      modelId: existingPersona.modelId ?? "",
      temperatureEnabled: existingPersona.temperature != null,
      temperature: existingPersona.temperature?.toString() ?? "1.0",
      maxTokensEnabled: existingPersona.maxTokens != null,
      maxTokens: existingPersona.maxTokens?.toString() ?? "",
      includeReasoningEnabled: existingPersona.includeReasoning != null,
      includeReasoning: existingPersona.includeReasoning ?? true,
      reasoningEffortEnabled: existingPersona.reasoningEffort != null,
      reasoningEffort: (existingPersona.reasoningEffort as "low" | "medium" | "high") ?? "medium",
      avatarEmoji: existingPersona.avatarEmoji ?? "🤖",
      avatarColor: existingPersona.avatarColor ?? "#6366f1",
      isDefault: existingPersona.isDefault ?? false,
      enabledIntegrations,
      selectedSkillIds,
      skillOverrides,
      integrationOverrides,
    });
    if (existingPersona.avatarImageUrl) setAvatarPreview(existingPersona.avatarImageUrl);
    setDidLoad(true);
  }, [existingPersona, didLoad, isNew, navigate]);

  // ── Field helpers ──────────────────────────────────────────────────────
  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleIntegration = useCallback(async (key: IntegrationKey) => {
    const isGoogleIntegration = key === "gmail" || key === "drive" || key === "calendar";
    const alreadyEnabled = form.enabledIntegrations.has(key);

    if (alreadyEnabled) {
      setForm((prev) => {
        const next = new Set(prev.enabledIntegrations);
        const nextOverrides = new Map(prev.integrationOverrides);
        next.delete(key);
        nextOverrides.set(key, false);
        return { ...prev, enabledIntegrations: next, integrationOverrides: nextOverrides };
      });
      return;
    }

    if (isGoogleIntegration) {
      const capabilityGranted =
        (key === "gmail" && googleConnection?.hasGmail) ||
        (key === "drive" && googleConnection?.hasDrive) ||
        (key === "calendar" && googleConnection?.hasCalendar);

      if (!capabilityGranted) {
        try {
          await connectProviderWithPopup("google", { requestedIntegration: key });
        } catch (err) {
          setError(convexErrorMessage(err, t("google_signin_failed")));
          return;
        }
      }
    }

    setForm((prev) => {
      const next = new Set(prev.enabledIntegrations);
      const nextOverrides = new Map(prev.integrationOverrides);
      next.add(key);
      nextOverrides.set(key, true);
      return { ...prev, enabledIntegrations: next, integrationOverrides: nextOverrides };
    });
  }, [form.enabledIntegrations, googleConnection, t]);

  const cycleSkill = useCallback((skillId: Id<"skills">) => {
    setForm((prev) => {
      const next = new Set(prev.selectedSkillIds);
      const nextOverrides = new Map(prev.skillOverrides);
      const nextState = cycleSkillOverride(nextOverrides.get(skillId));
      if (nextState === undefined) {
        nextOverrides.delete(skillId);
      } else {
        nextOverrides.set(skillId, nextState);
      }

      if (nextState === "available" || nextState === "always") {
        next.add(skillId);
      } else {
        next.delete(skillId);
      }

      return { ...prev, selectedSkillIds: next, skillOverrides: nextOverrides };
    });
  }, []);

  const handleAvatarSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!form.displayName.trim()) { setError(t("persona_name_required")); return; }
    if (!form.systemPrompt.trim()) { setError(t("persona_prompt_required")); return; }
    if (!form.modelId.trim()) { setError(t("persona_model_required")); return; }
    if (toolCapabilityError) { setError(toolCapabilityError); return; }
    setIsSaving(true);
    setError(null);
    try {
      let avatarImageStorageId: Id<"_storage"> | null | undefined;
      if (avatarFile) {
        const uploadUrl = await createUploadUrl({});
        const resp = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": avatarFile.type },
          body: avatarFile,
        });
        const { storageId } = (await resp.json()) as { storageId: Id<"_storage"> };
        avatarImageStorageId = storageId;
      }

      const payload = {
        displayName: form.displayName.trim(),
        personaDescription: form.personaDescription.trim() || undefined,
        systemPrompt: form.systemPrompt.trim(),
        modelId: form.modelId || undefined,
        temperature: form.temperatureEnabled && form.temperature ? parseFloat(form.temperature) : undefined,
        maxTokens: form.maxTokensEnabled && form.maxTokens ? parseInt(form.maxTokens, 10) : undefined,
        includeReasoning: form.includeReasoningEnabled ? form.includeReasoning : undefined,
        reasoningEffort: form.includeReasoningEnabled && form.includeReasoning && form.reasoningEffortEnabled
          ? form.reasoningEffort : undefined,
        avatarEmoji: form.avatarEmoji || undefined,
        avatarColor: form.avatarColor || undefined,
        isDefault: form.isDefault,
        ...(avatarImageStorageId !== undefined ? { avatarImageStorageId } : {}),
      };

      let savedPersonaId: Id<"personas">;
      if (isNew) {
        savedPersonaId = await createPersona(payload);
      } else {
        savedPersonaId = personaId as Id<"personas">;
        await updatePersona({ personaId: savedPersonaId, ...payload });
      }

      await setPersonaSkillOverrides({
        personaId: savedPersonaId,
        skillOverrides: Array.from(form.skillOverrides.entries()).map(([skillId, state]) => ({
          skillId: skillId as Id<"skills">,
          state,
        })),
      });
      await setPersonaIntegrationOverrides({
        personaId: savedPersonaId,
        integrationOverrides: Array.from(form.integrationOverrides.entries()).map(([integrationId, enabled]) => ({
          integrationId,
          enabled,
        })),
      });
      navigate("/app/personas");
    } catch (err) {
      setError(convexErrorMessage(err, t("persona_save_failed")));
    } finally {
      setIsSaving(false);
    }
  }, [form, avatarFile, isNew, personaId, createPersona, updatePersona, setPersonaSkillOverrides, setPersonaIntegrationOverrides, createUploadUrl, navigate, t, toolCapabilityError]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (!isNew && existingPersona === undefined) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  const visibleSkills = skills ?? [];
  const systemSkills = visibleSkills.filter((s) => s.scope === "system");
  const userSkills = visibleSkills.filter((s) => s.scope === "user");

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/50 flex-shrink-0">
        <button
          onClick={() => navigate("/app/personas")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{isNew ? t("new_persona_heading") : t("edit_persona_heading")}</h1>
        <button
          onClick={handleSave}
          disabled={isSaving || !!toolCapabilityError}
          className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? t("saving") : t("save")}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Form — iOS 7-section layout */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* 1. Identity */}
        <SettingsSection header={t("identity_section")} footer={t("identity_footer")}>
          <div className="px-4 py-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">{t("persona_name_label")}</label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setField("displayName", e.target.value)}
                placeholder={t("persona_name_placeholder")}
                className="w-full px-3 py-2 text-sm bg-surface-1 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">{t("persona_description_label")}</label>
              <input
                type="text"
                value={form.personaDescription}
                onChange={(e) => setField("personaDescription", e.target.value)}
                placeholder={t("persona_description_placeholder")}
                className="w-full px-3 py-2 text-sm bg-surface-1 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
          </div>
        </SettingsSection>

        {/* 2. Avatar */}
        <SettingsSection header={t("avatar_section")}>
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              {/* Avatar preview */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden cursor-pointer flex-shrink-0"
                style={{ backgroundColor: avatarPreview ? undefined : form.avatarColor }}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                ) : form.avatarEmoji ? (
                  <span className="text-2xl">{form.avatarEmoji}</span>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60">
                    <path d="M15.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" />
                    <path d="M3.5 20.5c0-3.5 3-6.5 8.5-6.5s8.5 3 8.5 6.5" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{avatarPreview ? t("change_avatar") : form.avatarEmoji ? t("change_avatar") : t("choose_avatar")}</p>
                <p className="text-xs text-muted mt-0.5">
                  {avatarPreview ? t("image_avatar_label") : form.avatarEmoji ? t("emoji_avatar_label") : t("emoji_or_image_label")}
                </p>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
          </div>
          {/* Use Emoji */}
          <div className="relative">
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left text-sm"
            >
              <span className="text-base">😀</span>
              <span>{t("use_emoji")}</span>
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                value={form.avatarEmoji}
                onChange={(e) => {
                  setField("avatarEmoji", e);
                  setAvatarPreview(null);
                  setAvatarFile(null);
                }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
          {/* Choose Image */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <span>{avatarPreview ? t("change_image") : t("choose_image")}</span>
          </button>
          {/* Remove Avatar */}
          {(avatarPreview || form.avatarEmoji) && (
            <button
              onClick={() => {
                setField("avatarEmoji", "");
                setAvatarFile(null);
                setAvatarPreview(null);
              }}
              className="w-full px-4 py-3 hover:bg-surface-3 transition-colors text-left text-sm text-red-400"
            >
              {t("remove_avatar")}
            </button>
          )}
          {/* Color picker */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="text-sm flex-1">{t("background_color")}</span>
            <input
              type="color"
              value={form.avatarColor}
              onChange={(e) => setField("avatarColor", e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
            />
          </div>
        </SettingsSection>

        {/* 3. Definition */}
        <SettingsSection
          header={t("definition_section")}
          footer={t("definition_footer")}
        >
          <div className="px-4 py-3">
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setField("systemPrompt", e.target.value)}
              placeholder={t("system_prompt_placeholder")}
              rows={6}
              className="w-full px-3 py-2 text-sm bg-surface-1 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted/60 resize-none font-mono"
            />
          </div>
        </SettingsSection>

        {/* 4. Locked Model */}
        <SettingsSection
          header={t("locked_model_section")}
          footer={t("locked_model_footer")}
        >
          <button
            onClick={() => setShowModelPicker(true)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm">{t("model_required_label")}</p>
              <p className={`text-xs mt-0.5 truncate ${form.modelId ? "text-primary" : "text-muted"}`}>
                {form.modelId ? form.modelId.split("/").pop() : t("select_a_model")}
              </p>
            </div>
            <ChevronRight size={14} className="text-muted flex-shrink-0" />
          </button>
        </SettingsSection>

        {toolCapabilityError && (
          <p className="text-xs text-red-400 px-4 -mt-2">{toolCapabilityError}</p>
        )}

        {/* 5. Parameter Overrides */}
        <SettingsSection
          header={t("param_overrides_section")}
          footer={t("param_overrides_footer")}
        >
          {/* Temperature */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm">{t("override_temperature")}</span>
            <Toggle checked={form.temperatureEnabled} onChange={(v) => setField("temperatureEnabled", v)} />
          </div>
          {form.temperatureEnabled && (
            <div className="px-4 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">{t("temperature_label")}</span>
                <span className="text-sm text-muted font-mono">{parseFloat(form.temperature || "1.0").toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0" max="2" step="0.1"
                value={form.temperature || "1.0"}
                onChange={(e) => setField("temperature", e.target.value)}
                className="w-full accent-primary"
              />
            </div>
          )}

          {/* Max Tokens */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm">{t("override_max_tokens")}</span>
            <Toggle checked={form.maxTokensEnabled} onChange={(v) => setField("maxTokensEnabled", v)} />
          </div>
          {form.maxTokensEnabled && (
            <div className="flex items-center gap-3 px-4 pb-3">
              <span className="text-sm">{t("max_tokens_label")}</span>
              <div className="flex-1" />
              <input
                type="text"
                inputMode="numeric"
                value={form.maxTokens}
                onChange={(e) => setField("maxTokens", e.target.value)}
                placeholder={t("max_tokens_placeholder")}
                className="w-24 px-2 py-1 text-sm text-right bg-surface-1 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
          )}

          {/* Reasoning */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm">{t("override_reasoning")}</span>
            <Toggle checked={form.includeReasoningEnabled} onChange={(v) => setField("includeReasoningEnabled", v)} />
          </div>
          {form.includeReasoningEnabled && (
            <>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm">{t("include_reasoning_label")}</span>
                <Toggle checked={form.includeReasoning} onChange={(v) => setField("includeReasoning", v)} />
              </div>
              {form.includeReasoning && (
                <>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="flex-1 text-sm">{t("override_reasoning_effort")}</span>
                    <Toggle checked={form.reasoningEffortEnabled} onChange={(v) => setField("reasoningEffortEnabled", v)} />
                  </div>
                  {form.reasoningEffortEnabled && (
                    <div className="px-4 pb-3">
                      <div className="flex gap-2">
                        {(["low", "medium", "high"] as const).map((level) => (
                          <button
                            key={level}
                            onClick={() => setField("reasoningEffort", level)}
                            className={`flex-1 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                              form.reasoningEffort === level
                                ? "bg-accent text-white"
                                : "bg-surface-1 text-muted hover:bg-surface-3"
                            }`}
                          >
                            {t(`reasoning_${level}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </SettingsSection>

        {/* 6a. Google Integrations */}
        {googleConnection && (
        <SettingsSection
          header={t("google_integrations_section")}
          footer={t("google_integrations_footer")}
        >
          <IntegrationRow slug="gmail" label={t("integration_gmail")} checked={form.enabledIntegrations.has("gmail")} onChange={() => toggleIntegration("gmail")} />
          <IntegrationRow slug="google-drive" label={t("integration_google_drive")} checked={form.enabledIntegrations.has("drive")} onChange={() => toggleIntegration("drive")} />
          <IntegrationRow slug="google-calendar" label={t("integration_google_calendar")} checked={form.enabledIntegrations.has("calendar")} onChange={() => toggleIntegration("calendar")} />
        </SettingsSection>
        )}

        {/* 6b. Microsoft Integrations */}
        {microsoftConnection && (
        <SettingsSection
          header={t("microsoft_integrations_section")}
          footer={t("microsoft_integrations_footer")}
        >
          <IntegrationRow slug="outlook" label={t("integration_outlook")} checked={form.enabledIntegrations.has("outlook")} onChange={() => toggleIntegration("outlook")} />
          <IntegrationRow slug="onedrive" label={t("integration_onedrive")} checked={form.enabledIntegrations.has("onedrive")} onChange={() => toggleIntegration("onedrive")} />
          <IntegrationRow slug="ms-calendar" label={t("integration_ms_calendar")} checked={form.enabledIntegrations.has("ms_calendar")} onChange={() => toggleIntegration("ms_calendar")} />
        </SettingsSection>
        )}

        {/* 6c. Apple Integration */}
        {appleCalendarConnection && (
        <SettingsSection
          header={t("apple_integration_section")}
          footer={t("apple_integration_footer")}
        >
          <IntegrationRow slug="apple-calendar" label={t("integration_apple_calendar")} checked={form.enabledIntegrations.has("apple_calendar")} onChange={() => toggleIntegration("apple_calendar")} />
        </SettingsSection>
        )}

        {/* 6d. Notion Integration */}
        {notionConnection && (
        <SettingsSection
          header={t("notion_integration_section")}
          footer={t("notion_integration_footer")}
        >
          <IntegrationRow slug="notion" label={t("integration_notion")} checked={form.enabledIntegrations.has("notion")} onChange={() => toggleIntegration("notion")} />
        </SettingsSection>
        )}

        {/* 6e. Cloze Integration */}
        {clozeConnection?.status === "active" && (
          <SettingsSection
            header={t("cloze_integration_section")}
            footer={t("cloze_integration_footer")}
          >
            <IntegrationRow slug="cloze" label={t("integration_cloze")} checked={form.enabledIntegrations.has("cloze")} onChange={() => toggleIntegration("cloze")} />
          </SettingsSection>
        )}

        {slackConnection && (
          <SettingsSection
            header={t("slack_integration_section")}
            footer={t("slack_integration_footer")}
          >
            <IntegrationRow slug="slack" label={t("integration_slack")} checked={form.enabledIntegrations.has("slack")} onChange={() => toggleIntegration("slack")} />
          </SettingsSection>
        )}

        {/* 7a. Built-in Skills */}
        {systemSkills.length > 0 && (
          <SettingsSection
            header={t("built_in_skills_section")}
            footer={`${t("persona_skills_inherit_help")} ${t("skill_override_cycle_hint")}`}
          >
            {systemSkills.map((skill) => (
              <SkillOverrideRow
                key={skill._id}
                skill={skill}
                state={form.skillOverrides.get(skill._id)}
                onCycle={() => cycleSkill(skill._id)}
                disabled={
                  !(form.skillOverrides.get(skill._id) === "available" || form.skillOverrides.get(skill._id) === "always")
                  && (skill.requiredIntegrationIds ?? []).length > 0
                  && (skill.requiredIntegrationIds ?? []).every((id) => !form.enabledIntegrations.has(id as IntegrationKey))
                }
              />
            ))}
          </SettingsSection>
        )}

        {/* 7b. User Skills */}
        {userSkills.length > 0 && (
          <SettingsSection
            header={t("your_skills_section_label")}
            footer={`${t("persona_skills_inherit_help")} ${t("skill_override_cycle_hint")}`}
          >
            {userSkills.map((skill) => (
              <SkillOverrideRow
                key={skill._id}
                skill={skill}
                state={form.skillOverrides.get(skill._id)}
                onCycle={() => cycleSkill(skill._id)}
                disabled={
                  !(form.skillOverrides.get(skill._id) === "available" || form.skillOverrides.get(skill._id) === "always")
                  && (skill.requiredIntegrationIds ?? []).length > 0
                  && (skill.requiredIntegrationIds ?? []).every((id) => !form.enabledIntegrations.has(id as IntegrationKey))
                }
              />
            ))}
          </SettingsSection>
        )}

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>

      {/* Model picker modal */}
      {showModelPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModelPicker(false); }}
        >
          <div className="w-full max-w-2xl bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[80vh]">
            <ModelPicker
              selectedModelId={form.modelId}
              onSelect={(modelId) => { setField("modelId", modelId); setShowModelPicker(false); }}
              onClose={() => setShowModelPicker(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
