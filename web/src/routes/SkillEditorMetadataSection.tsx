import { Check } from "lucide-react";
import type { SkillMetadataSelection } from "./SkillMetadataSelection";
import {
  SKILL_INTEGRATION_OPTIONS,
  requiredCapabilitiesForSkill,
  requiredToolProfilesForSkill,
} from "./SkillMetadataSelection";

interface Props {
  selection: SkillMetadataSelection;
  onChange: (selection: SkillMetadataSelection) => void;
}

function ToggleRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
    >
      <div className={`w-4 h-4 rounded border ${selected ? "border-accent bg-accent" : "border-border/60"}`}>
        {selected && <Check size={14} className="text-white" />}
      </div>
      <span className="text-sm flex-1">{label}</span>
    </button>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm text-foreground/70 text-right">{value}</span>
    </div>
  );
}

export function SkillEditorMetadataSection({ selection, onChange }: Props) {
  const requiredToolProfiles = requiredToolProfilesForSkill(selection);
  const requiredCapabilities = requiredCapabilitiesForSkill(selection);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">Tool routing</label>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          <ToggleRow
            label="Uses Documents"
            selected={selection.usesDocuments}
            onClick={() => onChange({ ...selection, usesDocuments: !selection.usesDocuments })}
          />
          <ToggleRow
            label="Uses Data Analysis"
            selected={selection.usesDataAnalysis}
            onClick={() => onChange({
              ...selection,
              usesDataAnalysis: !selection.usesDataAnalysis,
              usesCodingWorkspace: selection.usesDataAnalysis ? selection.usesCodingWorkspace : false,
            })}
          />
          <ToggleRow
            label="Uses Coding Workspace"
            selected={selection.usesCodingWorkspace}
            onClick={() => onChange({ ...selection, usesCodingWorkspace: !selection.usesCodingWorkspace })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">Connected apps</label>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {SKILL_INTEGRATION_OPTIONS.map((option) => {
            const selected = selection.selectedIntegrationIds.has(option.id);
            return (
              <ToggleRow
                key={option.id}
                label={option.label}
                selected={selected}
                onClick={() => {
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

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground/50 uppercase tracking-wide">Metadata preview</label>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          <PreviewRow
            label="Profiles"
            value={requiredToolProfiles.length > 0 ? requiredToolProfiles.join(", ") : "None"}
          />
          <PreviewRow
            label="Capabilities"
            value={requiredCapabilities.length > 0 ? requiredCapabilities.join(", ") : "None"}
          />
          <PreviewRow
            label="Integrations"
            value={selection.selectedIntegrationIds.size > 0 ? Array.from(selection.selectedIntegrationIds).sort().join(", ") : "None"}
          />
        </div>
        <p className="text-xs text-muted px-1">
          The backend revalidates and normalizes this metadata when you save.
        </p>
      </div>
    </div>
  );
}
