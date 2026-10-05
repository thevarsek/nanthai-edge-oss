import { Laptop, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "@/components/settings/SettingsHelpers";
import { PersonaRuntimeModelPicker } from "./PersonaRuntimeModelPicker";
import type { PersonaRuntimeDevice, PersonaRuntimeRoute } from "./PersonaRuntimeRoute";

function isRuntimeReady(device: PersonaRuntimeDevice): boolean {
  return device.isOnline && device.adapters.some(
    (adapter) => adapter.isAvailable ?? adapter.authState === "ready",
  );
}

export function PersonaRuntimeSection({
  route,
  devices,
  onChange,
}: {
  route: PersonaRuntimeRoute | null;
  devices: PersonaRuntimeDevice[] | undefined;
  onChange: (route: PersonaRuntimeRoute | null) => void;
}) {
  const { t } = useTranslation();
  const readyDevices = (devices ?? []).filter(isRuntimeReady);
  const selectedDevice = (devices ?? []).find((device) => device.deviceId === route?.deviceId);
  const selectLocal = () => {
    if (route) { onChange(route); return; }
    const device = selectedDevice ?? readyDevices[0];
    onChange(device ? {
      deviceId: device.deviceId,
      adapterId: device.adapters.find(adapter => adapter.isAvailable ?? adapter.authState === "ready")?.adapterId ?? "codex",
      modelSelectionMode: "adapter_default",
    } : {
      deviceId: "",
      adapterId: "codex",
      modelSelectionMode: "adapter_default",
    });
  };

  return (
    <SettingsSection
      header={t("persona_runtime_section")}
      footer={t("persona_runtime_footer")}
      noPadding
    >
      <div className="rounded-2xl bg-surface-2 divide-y divide-border/50">
      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <button
          type="button"
          aria-pressed={route === null}
          onClick={() => onChange(null)}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            route === null
              ? "bg-accent text-white"
              : "bg-surface-1 text-muted hover:bg-surface-3"
          }`}
        >
          <Server size={14} />
          {t("persona_runtime_cloud")}
        </button>
        <button
          type="button"
          aria-pressed={route !== null}
          onClick={selectLocal}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            route !== null
              ? "bg-accent text-white"
              : "bg-surface-1 text-muted hover:bg-surface-3"
          }`}
        >
          <Laptop size={14} />
          {t("persona_runtime_local")}
        </button>
      </div>

      {route && (
        <div className="space-y-3 px-4 py-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">
              {t("persona_runtime_machine")}
            </span>
            <select
              value={route.deviceId}
              onChange={(event) => {
                const device = readyDevices.find(value => value.deviceId === event.target.value);
                onChange({ deviceId: event.target.value,
                  adapterId: device?.adapters.find(adapter => adapter.adapterId === route.adapterId && (adapter.isAvailable ?? adapter.authState === "ready"))?.adapterId
                    ?? device?.adapters.find(adapter => adapter.isAvailable ?? adapter.authState === "ready")?.adapterId ?? route.adapterId,
                  modelSelectionMode: "adapter_default" });
              }}
              disabled={devices === undefined || readyDevices.length === 0}
              className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              {readyDevices.length === 0 && (
                <option value="">{t("persona_runtime_no_online")}</option>
              )}
              {readyDevices.length > 0 && !route.deviceId && (
                <option value="" disabled>{t("persona_runtime_choose_machine")}</option>
              )}
              {selectedDevice && !isRuntimeReady(selectedDevice) && (
                <option value={selectedDevice.deviceId} disabled>
                  {selectedDevice.displayName} · {t("runtime_status_offline")}
                </option>
              )}
              {readyDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.displayName}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg bg-surface-1 px-3 py-2">
            <p className="text-xs font-medium text-muted">{t("persona_runtime_adapter")}</p>
            <select aria-label={t("persona_runtime_adapter")} value={route.adapterId}
              onChange={event => onChange({ deviceId: route.deviceId, adapterId: event.target.value, modelSelectionMode: "adapter_default" })}
              className="mt-1 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
              {!selectedDevice?.adapters.some(adapter => adapter.adapterId === route.adapterId && (adapter.isAvailable ?? adapter.authState === "ready")) &&
                <option value={route.adapterId} disabled>{route.adapterId}</option>}
              {selectedDevice?.adapters.filter(adapter => adapter.isAvailable ?? adapter.authState === "ready").map(adapter =>
                <option key={adapter.adapterId} value={adapter.adapterId}>{adapter.displayName ?? adapter.adapterId}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">
              {route.modelSelectionMode === "explicit" && route.modelId
                ? t("persona_runtime_explicit_model", { model: route.modelId })
                : t("persona_runtime_adapter_default")}
            </p>
          </div>

          <PersonaRuntimeModelPicker
            key={`${route.deviceId}:${route.adapterId}`}
            route={route}
            device={selectedDevice}
            onChange={onChange}
          />
        </div>
      )}
      </div>
    </SettingsSection>
  );
}
