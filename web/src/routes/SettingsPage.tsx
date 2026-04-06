import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, MessageSquare, Clock, Drama, Wand2, ClipboardList, Brain, Camera, Mail, Link as LinkIcon, RotateCcw } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

import { AccountSection } from "@/components/settings/AccountSection";
import { OpenRouterSection } from "@/components/settings/OpenRouterSection";
import { IntegrationsSection, IntegrationsSubPage } from "@/components/settings/IntegrationsSection";
import { ProvidersSection } from "@/components/settings/ProvidersSection";
import { ChatDefaultsSection } from "@/components/settings/ChatDefaultsSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { ProGateWrapper } from "@/hooks/useProGate";
import {
  SettingsSection, NavRow, SettingsRow, SignOutSection, DeleteAccountSection, LegalSection,
} from "@/components/settings/SettingsHelpers";

// ─── Types ─────────────────────────────────────────────────────────────────

type SubPage = "integrations" | "chat-defaults" | "user-profile";

// ─── Main settings list ─────────────────────────────────────────────────────

function SettingsMain({ onNavigate }: { onNavigate: (page: SubPage) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const upsertPreferences = useMutation(api.preferences.mutations.upsertPreferences);

  const handleReplayWalkthrough = useCallback(() => {
    void upsertPreferences({ hasSeenMainWalkthrough: false });
    navigate("/app");
  }, [upsertPreferences, navigate]);

  const handleReplayOnboarding = useCallback(() => {
    navigate("/onboarding?mode=replay");
  }, [navigate]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Account — noPadding because AccountSection has its own card */}
      <SettingsSection header={t("account_section_header")} noPadding>
        <AccountSection onShowProfile={() => onNavigate("user-profile")} />
      </SettingsSection>

      {/* OpenRouter — noPadding because OpenRouterSection has its own cards */}
      <SettingsSection header={t("openrouter_section_header")} noPadding>
        <OpenRouterSection />
      </SettingsSection>

      {/* Integrations — noPadding because IntegrationsSection has its own card */}
      <SettingsSection
        header={t("integrations_section_header")}
        footer={t("integrations_footer")}
        noPadding
      >
        <IntegrationsSection onNavigate={(page) => onNavigate(page)} />
      </SettingsSection>

      {/* Model Providers */}
      <SettingsSection
        header={t("model_providers_section_header")}
        footer={t("toggle_providers_appear")}
        noPadding
      >
        <ProvidersSection />
      </SettingsSection>

      {/* Chat Defaults */}
      <SettingsSection header={t("chat_defaults_section_header")}>
        <NavRow
          icon={<MessageSquare size={16} />}
          label={t("chat_defaults_section_header")}
          onClick={() => onNavigate("chat-defaults")}
        />
      </SettingsSection>

      {/* Scheduled Jobs */}
      <SettingsSection header={t("scheduled_jobs_section_header")}>
        <ProGateWrapper feature="Scheduled Jobs">
          <NavRow icon={<Clock size={16} />} label={t("scheduled_jobs_nav")} href="/app/settings/jobs" />
        </ProGateWrapper>
      </SettingsSection>

      {/* AI Personas */}
      <SettingsSection header={t("ai_personas_section_header")}>
        <ProGateWrapper feature="AI Personas">
          <NavRow icon={<Drama size={16} />} label={t("manage_personas")} href="/app/personas" />
        </ProGateWrapper>
      </SettingsSection>

      {/* AI Skills */}
      <SettingsSection header={t("ai_skills_section_header")}>
        <ProGateWrapper feature="AI Skills">
          <NavRow icon={<Wand2 size={16} />} label={t("manage_skills")} href="/app/settings/skills" />
        </ProGateWrapper>
      </SettingsSection>

      {/* Knowledge Base */}
      <SettingsSection header={t("knowledge_base_section_header")}>
        <ProGateWrapper feature="Knowledge Base">
          <NavRow icon={<ClipboardList size={16} />} label={t("files_and_documents")} href="/app/settings/knowledge" />
        </ProGateWrapper>
      </SettingsSection>

      {/* Memory */}
      <SettingsSection header={t("memory_section_header")}>
        <ProGateWrapper feature="Memory">
          <NavRow icon={<Brain size={16} />} label={t("memory_settings")} href="/app/settings/memory" />
        </ProGateWrapper>
      </SettingsSection>

      {/* Appearance — noPadding because AppearanceSection has its own cards */}
      <SettingsSection header={t("appearance")} noPadding>
        <AppearanceSection />
      </SettingsSection>

      {/* Notifications — noPadding because NotificationsSection has its own cards */}
      <SettingsSection header={t("notifications")} noPadding>
        <NotificationsSection />
      </SettingsSection>

      {/* Support */}
      <SettingsSection header={t("support_section_header")}>
        <SettingsRow onClick={handleReplayOnboarding}>
          <span className="text-primary flex-shrink-0"><RotateCcw size={16} /></span>
          <div className="flex-1">
            <p className="text-sm">{t("replay_setup_tour")}</p>
            <p className="text-xs text-muted">{t("replay_setup_tour_description")}</p>
          </div>
        </SettingsRow>
        <SettingsRow onClick={handleReplayWalkthrough}>
          <span className="text-primary flex-shrink-0"><RotateCcw size={16} /></span>
          <div className="flex-1">
            <p className="text-sm">{t("replay_in_app_walkthrough")}</p>
            <p className="text-xs text-muted">{t("replay_in_app_walkthrough_description")}</p>
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Legal */}
      <SettingsSection header={t("legal_section_header")} noPadding>
        <LegalSection />
      </SettingsSection>

      {/* Sign Out + Delete Account */}
      <SignOutSection />
      <DeleteAccountSection />
    </div>
  );
}

function SubPageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 border-b border-border/50">
      <button
        onClick={onBack}
        className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
      >
        <ChevronLeft size={18} />
      </button>
      <h1 className="text-lg font-semibold flex-1">{title}</h1>
    </div>
  );
}

// ─── Sub-page renderer ──────────────────────────────────────────────────────

function SubPageContent({ page, onBack }: { page: SubPage; onBack: () => void }) {
  const { t } = useTranslation();

  switch (page) {
    case "chat-defaults":
      return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <SubPageHeader title={t("chat_defaults_section_header")} onBack={onBack} />
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
            <div className="max-w-4xl mx-auto pb-10">
              <ChatDefaultsSection />
            </div>
          </div>
        </div>
      );
    case "integrations":
      return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <SubPageHeader title={t("integrations_section_header")} onBack={onBack} />
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
            <div className="max-w-4xl mx-auto pb-10">
              <IntegrationsSubPage />
            </div>
          </div>
        </div>
      );
    case "user-profile":
      return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <SubPageHeader title={t("account_section_header")} onBack={onBack} />
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
            <div className="max-w-4xl mx-auto pb-10">
              <UserProfileContent />
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

// ─── User Profile ──────────────────────────────────────────────────────────

function formatProviderName(provider: string): string {
  const stripped = provider.startsWith("oauth_") ? provider.slice(6) : provider;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function UserProfileContent() {
  const { t } = useTranslation();
  const { user } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePhotoUpload = useCallback(async (file: File) => {
    if (!user) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      await user.setProfileImage({ file });
    } catch (err) {
      setErrorMessage(t("upload_failed_arg", { var1: err instanceof Error ? err.message : "Unknown error" }));
    } finally {
      setIsUploading(false);
    }
  }, [user, t]);

  const handleRemovePhoto = useCallback(async () => {
    if (!user) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      await user.setProfileImage({ file: null });
    } catch (err) {
      setErrorMessage(t("remove_failed_arg", { var1: err instanceof Error ? err.message : "Unknown error" }));
    } finally {
      setIsUploading(false);
    }
  }, [user, t]);

  if (!user) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const primaryEmail = user.primaryEmailAddress?.emailAddress;
  const emails = user.emailAddresses ?? [];
  const externalAccounts = user.externalAccounts ?? [];

  // Deduplicate external accounts by provider
  const seenProviders = new Set<string>();
  const uniqueAccounts = externalAccounts.filter((a) => {
    if (seenProviders.has(a.provider ?? "")) return false;
    seenProviders.add(a.provider ?? "");
    return true;
  });

  const initial = displayName
    ? displayName.charAt(0).toUpperCase()
    : primaryEmail?.charAt(0).toUpperCase() ?? "?";

  return (
    <div className="space-y-6">
      {/* Profile section */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("profile_section")}</p>
        <div className="rounded-2xl bg-surface-2 overflow-hidden">
          <div className="flex flex-col items-center py-6 px-4">
            {/* Avatar with camera badge */}
            <div className="relative group">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="relative"
              >
                {isUploading ? (
                  <div className="w-20 h-20 rounded-full bg-surface-3 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : user.imageUrl ? (
                  <img
                    src={user.imageUrl}
                    alt={displayName || "Profile"}
                    className="w-20 h-20 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-surface-3 flex items-center justify-center">
                    <span className="text-2xl font-semibold text-muted">{initial}</span>
                  </div>
                )}
                {/* Camera badge */}
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                  <Camera size={12} className="text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePhotoUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Remove photo link */}
            {user.hasImage && !isUploading && (
              <button
                onClick={() => void handleRemovePhoto()}
                className="mt-2 text-xs text-destructive hover:underline"
              >
                {t("remove_photo")}
              </button>
            )}

            {/* Name + email */}
            {displayName && (
              <p className="mt-3 text-lg font-semibold">{displayName}</p>
            )}
            {primaryEmail && (
              <p className="text-sm text-muted mt-0.5">{primaryEmail}</p>
            )}

            {/* Error message */}
            {errorMessage && (
              <p className="mt-2 text-xs text-destructive text-center">{errorMessage}</p>
            )}
          </div>
        </div>
      </div>

      {/* Email Addresses section */}
      {emails.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("email_addresses")}</p>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            {emails.map((email) => (
              <div key={email.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 rounded-md bg-background flex items-center justify-center flex-shrink-0">
                  <Mail size={14} className="text-primary" />
                </div>
                <span className="text-sm flex-1 truncate">{email.emailAddress}</span>
                {email.id === user.primaryEmailAddressId && (
                  <span className="text-[10px] font-semibold text-green-400 bg-green-400/12 px-2 py-0.5 rounded-full">
                    {t("primary_email_badge")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connected Accounts section */}
      {uniqueAccounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("connected_accounts")}</p>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            {uniqueAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 rounded-md bg-background flex items-center justify-center flex-shrink-0">
                  <LinkIcon size={14} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{formatProviderName(account.provider ?? "unknown")}</p>
                  {account.emailAddress && (
                    <p className="text-xs text-muted truncate">{account.emailAddress}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings Page ─────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t } = useTranslation();
  const [subPage, setSubPage] = useState<SubPage | null>(null);
  const navigate = useNavigate();

  const handleCloseSettings = useCallback(() => {
    const historyIndex = window.history.state?.idx as number | undefined;
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate("/app");
  }, [navigate]);

  if (subPage) {
    return <SubPageContent page={subPage} onBack={() => setSubPage(null)} />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button
            onClick={handleCloseSettings}
            className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
            aria-label="Close settings"
            title="Close settings"
          >
            <span className="md:hidden">
              <ChevronLeft size={18} />
            </span>
            <span className="hidden md:block text-sm font-medium px-1">{t("done")}</span>
          </button>
          <h1 className="text-lg font-semibold flex-1 md:flex-none">{t("settings_title")}</h1>
          <div className="w-8 md:hidden" aria-hidden="true" />
        </div>
        <SettingsMain onNavigate={(page) => setSubPage(page)} />
      </div>
    </div>
  );
}
