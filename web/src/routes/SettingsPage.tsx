import { TelegramChannelSettings } from "@/components/settings/TelegramChannelSettings";
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, MessageSquare, Clock, Drama, Wand2, ClipboardList, Brain, Link as LinkIcon, RotateCcw } from "lucide-react";
import { SettingsUserProfileContent } from "@/components/settings/SettingsUserProfileContent";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

import { AccountSection } from "@/components/settings/AccountSection";
import { AIConnectionsSection } from "@/components/settings/AIConnectionsSection";
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

type SubPage = "integrations" | "chat-defaults" | "user-profile" | "openrouter" | "telegram";

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

      <AIConnectionsSection onOpenRouter={() => onNavigate("openrouter")} onTelegram={() => onNavigate("telegram")} />
      <SettingsSection header={t("external_mcp_title")}>
        <NavRow icon={<LinkIcon size={16} />} label={t("external_mcp_title")} href="/app/settings/mcp-connections" />
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
        <ProGateWrapper featureId="scheduledJobs">
          <NavRow icon={<Clock size={16} />} label={t("scheduled_jobs_nav")} href="/app/settings/jobs" />
        </ProGateWrapper>
      </SettingsSection>

      {/* AI Personas */}
      <SettingsSection header={t("ai_personas_section_header")}>
        <ProGateWrapper featureId="aiPersonas">
          <NavRow icon={<Drama size={16} />} label={t("manage_personas")} href="/app/personas" />
        </ProGateWrapper>
      </SettingsSection>

      {/* AI Skills */}
      <SettingsSection header={t("ai_skills_section_header")}>
        <ProGateWrapper featureId="aiSkills">
          <NavRow icon={<Wand2 size={16} />} label={t("manage_skills")} href="/app/settings/skills" />
        </ProGateWrapper>
      </SettingsSection>

      {/* Knowledge Base */}
      <SettingsSection header={t("knowledge_base_section_header")}>
        <ProGateWrapper featureId="knowledgeBase">
          <NavRow icon={<ClipboardList size={16} />} label={t("files_and_documents")} href="/app/settings/knowledge" />
        </ProGateWrapper>
      </SettingsSection>

      {/* Memory */}
      <SettingsSection header={t("memory_section_header")}>
        <ProGateWrapper featureId="memory">
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
    case "telegram":
      return <div className="flex-1 flex flex-col h-full overflow-hidden">
        <SubPageHeader title="Telegram" onBack={onBack} />
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8"><div className="max-w-4xl mx-auto"><TelegramChannelSettings /></div></div>
      </div>;
    case "openrouter":
      return <div className="flex-1 flex flex-col h-full overflow-hidden">
        <SubPageHeader title="OpenRouter" onBack={onBack} />
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8"><div className="max-w-4xl mx-auto"><OpenRouterSection /></div></div>
      </div>;
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
              <SettingsUserProfileContent />
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

// ─── Settings Page ─────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [subPage, setSubPage] = useState<SubPage | null>(() => {
    if (hash === "#telegram") return "telegram";
    if (hash === "#chat-defaults") return "chat-defaults";
    return null;
  });
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
