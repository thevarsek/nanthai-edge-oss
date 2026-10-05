import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { convexErrorMessage } from "@/lib/convexErrors";
import { RuntimeModelCombobox } from "./RuntimeModelCombobox";
import type { PersonaRuntimeDevice, PersonaRuntimeRoute } from "./PersonaRuntimeRoute";

type DiscoveryRequest = {
  requestId: Id<"runtimeModelDiscoveryRequests">;
  deviceId: string;
  adapterId: string;
};

export function PersonaRuntimeModelPicker({
  route,
  device,
  onChange,
}: {
  route: PersonaRuntimeRoute;
  device: PersonaRuntimeDevice | undefined;
  onChange: (route: PersonaRuntimeRoute) => void;
}) {
  const { t } = useTranslation();
  const requestModels = useMutation(api.runtime_host.model_discovery.requestModels);
  const [request, setRequest] = useState<DiscoveryRequest | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const requestMatchesRoute = request?.deviceId === route.deviceId
    && request.adapterId === route.adapterId;
  const discovery = useQuery(
    api.runtime_host.model_discovery.getMyRequest,
    request && requestMatchesRoute ? { requestId: request.requestId } : "skip",
  );
  const adapter = device?.adapters.find((candidate) => candidate.adapterId === route.adapterId);
  const reconnectRequired = !device?.isOnline;
  const adapterUnavailable = !!device?.isOnline && adapter?.authState !== "ready";
  const discoveryUnsupported = !!device?.isOnline
    && adapter?.authState === "ready"
    && !adapter.operations.listModels;
  const canDiscover = !!device?.isOnline
    && adapter?.authState === "ready"
    && adapter.operations.listModels;
  const currentDiscovery = discovery
    && discovery.deviceId === route.deviceId
    && discovery.adapterId === route.adapterId
      ? discovery
      : null;
  const discovering = requesting
    || (requestMatchesRoute && discovery === undefined)
    || currentDiscovery?.status === "pending"
    || currentDiscovery?.status === "claimed";
  const selectedModelIndex = route.modelSelectionMode === "explicit"
    ? currentDiscovery?.models.findIndex((model) =>
        model.modelId === route.modelId
        && model.provider === (route.provider ?? null)
      ) ?? -1
    : -1;

  const discover = async () => {
    if (!canDiscover || requesting) return;
    setRequestError(null);
    setRequesting(true);
    try {
      const result = await requestModels({
        deviceId: route.deviceId,
        adapterId: route.adapterId,
      });
      setRequest({
        requestId: result.requestId,
        deviceId: route.deviceId,
        adapterId: route.adapterId,
      });
    } catch (cause) {
      setRequestError(convexErrorMessage(cause, t("persona_runtime_discovery_failed")));
    } finally {
      setRequesting(false);
    }
  };

  const useAdapterDefault = () => onChange({
    deviceId: route.deviceId,
    adapterId: route.adapterId,
    modelSelectionMode: "adapter_default",
  });

  const selectModel = (index: number) => {
    if (!canDiscover) return;
    const model = currentDiscovery?.models[index];
    if (!model || model.availability !== "available") return;
    onChange({
      deviceId: route.deviceId,
      adapterId: route.adapterId,
      modelSelectionMode: "explicit",
      ...(model.provider === null ? {} : { provider: model.provider }),
      modelId: model.modelId,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {route.modelSelectionMode === "explicit" && (
          <button
            type="button"
            onClick={useAdapterDefault}
            className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:bg-surface-3"
          >
            {t("persona_runtime_use_adapter_default")}
          </button>
        )}
        {canDiscover && (
          <button
            type="button"
            onClick={() => void discover()}
            disabled={discovering}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-primary transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {discovering && <Loader2 size={13} className="animate-spin" />}
            {route.modelSelectionMode === "explicit"
              ? t("persona_runtime_change_model")
              : t("persona_runtime_choose_model")}
          </button>
        )}
      </div>

      {reconnectRequired && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          {t("persona_runtime_model_reconnect")}
        </p>
      )}
      {adapterUnavailable && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          {t("persona_runtime_adapter_unavailable")}
        </p>
      )}
      {discoveryUnsupported && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          {t("persona_runtime_discovery_unsupported")}
        </p>
      )}
      {(requestError || currentDiscovery?.status === "failed") && (
        <div role="alert" className="space-y-2 text-xs text-red-600 dark:text-red-400">
          <p>{requestError ?? currentDiscovery?.error?.message ?? t("persona_runtime_discovery_failed")}</p>
          {canDiscover && (
            <button type="button" onClick={() => void discover()} className="text-primary hover:underline">
              {t("retry")}
            </button>
          )}
        </div>
      )}
      {(currentDiscovery?.status === "expired" || (requestMatchesRoute && discovery === null)) && (
        <div role="alert" className="space-y-2 text-xs text-amber-700 dark:text-amber-300">
          <p>{t("persona_runtime_discovery_expired")}</p>
          {canDiscover && (
            <button type="button" onClick={() => void discover()} className="text-primary hover:underline">
              {t("retry")}
            </button>
          )}
        </div>
      )}
      {canDiscover
        && currentDiscovery?.status === "completed"
        && currentDiscovery.models.length === 0 && (
        <p role="status" className="text-xs text-muted">
          {t("persona_runtime_no_models")}
        </p>
      )}
      {canDiscover
        && currentDiscovery?.status === "completed"
        && currentDiscovery.models.length > 0 && (
        <RuntimeModelCombobox
          key={`${route.deviceId}:${route.adapterId}:${currentDiscovery.requestId}`}
          autoOpen
          models={currentDiscovery.models}
          selectedIndex={selectedModelIndex}
          onSelect={selectModel}
        />
      )}
    </div>
  );
}
