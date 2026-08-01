import {
  Braces,
  Clock3,
  FileInput,
  KeyRound,
  ListChecks,
  MessageSquareMore,
  ServerCog,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type Capability, type HowItWorksStep } from "./FeaturePageLayout";
import { RemoteMcpIllustration } from "./illustrations/RemoteMcpIllustration";

const meta = getFeature("remote-mcp")!;

function getSteps(t: (key: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("mcp_step1_title"), description: t("mcp_step1_desc"), icon: <ServerCog size={18} /> },
    { number: 2, title: t("mcp_step2_title"), description: t("mcp_step2_desc"), icon: <ListChecks size={18} /> },
    { number: 3, title: t("mcp_step3_title"), description: t("mcp_step3_desc"), icon: <UsersRound size={18} /> },
  ];
}

function getCapabilities(t: (key: string) => string): Capability[] {
  return [
    { icon: <Braces size={18} />, title: t("mcp_cap_tools_title"), description: t("mcp_cap_tools_desc") },
    { icon: <FileInput size={18} />, title: t("mcp_cap_context_title"), description: t("mcp_cap_context_desc") },
    { icon: <MessageSquareMore size={18} />, title: t("mcp_cap_questions_title"), description: t("mcp_cap_questions_desc") },
    { icon: <Clock3 size={18} />, title: t("mcp_cap_tasks_title"), description: t("mcp_cap_tasks_desc") },
    { icon: <KeyRound size={18} />, title: t("mcp_cap_auth_title"), description: t("mcp_cap_auth_desc") },
    { icon: <ShieldCheck size={18} />, title: t("mcp_cap_controls_title"), description: t("mcp_cap_controls_desc") },
  ];
}

function ProtocolNote() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.025)] p-6 md:p-8">
      <p className="edge-label text-[var(--edge-cyan)]">{t("mcp_compatibility_label")}</p>
      <h2 className="mt-3 edge-display text-[1.45rem] efg-heading">{t("mcp_compatibility_title")}</h2>
      <p className="mt-3 text-[0.9rem] leading-relaxed efg-50">
        {t("mcp_compatibility_desc_before")} <code>2026-07-28</code>. {t("mcp_compatibility_desc_after")}
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.82rem] font-medium">
        <a className="text-[var(--edge-coral)] hover:underline" href="https://blog.modelcontextprotocol.io/posts/2026-07-28/" target="_blank" rel="noreferrer">{t("mcp_link_release")}</a>
        <a className="text-[var(--edge-coral)] hover:underline" href="https://modelcontextprotocol.io/specification/2026-07-28" target="_blank" rel="noreferrer">{t("mcp_link_specification")}</a>
        <a className="text-[var(--edge-coral)] hover:underline" href="https://modelcontextprotocol.io/docs/learn/architecture" target="_blank" rel="noreferrer">{t("mcp_link_docs")}</a>
        <a className="text-[var(--edge-coral)] hover:underline" href="https://modelcontextprotocol.io/extensions/tasks/overview" target="_blank" rel="noreferrer">{t("mcp_link_tasks")}</a>
      </div>
    </div>
  );
}

export function RemoteMcpServersPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<RemoteMcpIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={[
        t("mcp_scenario_1"),
        t("mcp_scenario_2"),
        t("mcp_scenario_3"),
        t("mcp_scenario_4"),
      ]}
      extraContent={<ProtocolNote />}
      seoDescription={t("mcp_seo_desc")}
    />
  );
}
