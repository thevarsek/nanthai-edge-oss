import { BarChart3, FileText, Terminal } from "lucide-react";
import { Toggle } from "@/components/shared/Toggle";
import type { SkillMetadataSelection } from "./SkillMetadataSelection";
import type { RemoteMcpConnectionOption } from "@/lib/remoteMcp";
import { IntegrationRow } from "./PersonaEditorHelpers";
import { SKILL_INTEGRATION_OPTIONS } from "./SkillMetadataSelection";
import { useTranslation } from "react-i18next";

interface Props {
  selection: SkillMetadataSelection;
  remoteMcpConnections?: RemoteMcpConnectionOption[];
  onChange: (selection: SkillMetadataSelection) => void;
}

function ToolRoutingRow({
  icon,
  label,
  selected,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  onChange: (selected: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex w-[22px] flex-shrink-0 items-center justify-center text-primary">{icon}</span>
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <Toggle checked={selected} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function integrationSlug(integrationId: string): string {
  if (integrationId === "drive") return "google-drive";
  if (integrationId === "calendar") return "google-calendar";
  if (integrationId === "ms_calendar") return "ms-calendar";
  if (integrationId === "apple_calendar") return "apple-calendar";
  return integrationId;
}

export function SkillEditorMetadataSection({ selection, remoteMcpConnections = [], onChange }: Props) {
  const { t } = useTranslation();
  const integrationOptions = [
    ...SKILL_INTEGRATION_OPTIONS.map((option) => ({
      ...option,
      slug: integrationSlug(option.id),
      remoteMcp: false,
      subtitle: undefined as string | undefined,
    })),
    ...remoteMcpConnections.map((connection) => ({
      id: connection.integrationId,
      label: connection.displayName,
      slug: connection.integrationId,
      remoteMcp: true,
      subtitle: `${connection.endpointHost} · ${t("remote_mcp_allowed_items", { count: connection.allowedItemCount })}`,
    })),
  ];
  const knownIntegrationIds = new Set(integrationOptions.map((option) => option.id));
  for (const integrationId of selection.selectedIntegrationIds) {
    if (!knownIntegrationIds.has(integrationId)) {
      integrationOptions.push({
        id: integrationId,
        label: t("unavailable_integration"),
        slug: integrationId,
        remoteMcp: integrationId.startsWith("mcp:"),
        subtitle: t("remote_mcp_skill_disconnected_help"),
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("tool_routing")}</label>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          <ToolRoutingRow
            icon={<FileText size={20} />}
            label={t("skill_uses_documents")}
            selected={selection.usesDocuments}
            onChange={(usesDocuments) => onChange({ ...selection, usesDocuments })}
          />
          <ToolRoutingRow
            icon={<BarChart3 size={20} />}
            label={t("skill_uses_data_analysis")}
            selected={selection.usesDataAnalysis}
            onChange={(usesDataAnalysis) => onChange({ ...selection, usesDataAnalysis })}
          />
          <ToolRoutingRow
            icon={<Terminal size={20} />}
            label={t("skill_uses_coding_workspace")}
            selected={selection.usesCodingWorkspace}
            onChange={(usesCodingWorkspace) => onChange({ ...selection, usesCodingWorkspace })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("connected_apps")}</label>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {integrationOptions.map((option) => {
            const selected = selection.selectedIntegrationIds.has(option.id);
            return (
              <IntegrationRow
                key={option.id}
                slug={option.slug}
                label={option.label}
                subtitle={option.subtitle}
                remoteMcp={option.remoteMcp}
                checked={selected}
                onChange={() => {
                  const nextIds = new Set(selection.selectedIntegrationIds);
                  if (selected) nextIds.delete(option.id);
                  else nextIds.add(option.id);
                  onChange({ ...selection, selectedIntegrationIds: nextIds });
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
