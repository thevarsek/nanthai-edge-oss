import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings/SettingsHelpers";
import { PersonaRuntimeSection } from "./PersonaRuntimeSection";
import type { PersonaRuntimeDevice, PersonaRuntimeRoute } from "./PersonaRuntimeRoute";

export function PersonaExecutionSection({ route, devices, modelId, toolCapabilityError, onChange, onChooseCloudModel }: {
  route: PersonaRuntimeRoute | null;
  devices: PersonaRuntimeDevice[] | undefined;
  modelId: string;
  toolCapabilityError: string | null;
  onChange: (route: PersonaRuntimeRoute | null) => void;
  onChooseCloudModel: () => void;
}) {
  const { t } = useTranslation();
  return <>
        <PersonaRuntimeSection
          route={route}
          devices={devices}
          onChange={onChange}
        />

        {!route && (
          <SettingsSection
            header={t("locked_model_section")}
            footer={t("persona_cloud_model_footer")}
          >
            <button
              type="button"
              onClick={onChooseCloudModel}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm">{t("model_required_label")}</p>
                <p className={`text-xs mt-0.5 truncate ${modelId ? "text-primary" : "text-muted"}`}>
                  {modelId ? modelId.split("/").pop() : t("select_a_model")}
                </p>
              </div>
              <ChevronRight size={14} className="text-muted flex-shrink-0" />
            </button>
          </SettingsSection>
        )}

        {toolCapabilityError && !route && (
          <p className="text-xs text-red-400 px-4 -mt-2">{toolCapabilityError}</p>
        )}

  </>;
}
