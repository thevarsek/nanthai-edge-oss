import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Laptop, Loader2, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useSharedData } from "@/hooks/useSharedData";
import { buildPersonaParticipants, launchChat } from "@/lib/chatLaunch";
import { Defaults } from "@/lib/constants";
import { convexErrorMessage } from "@/lib/convexErrors";
import { useRuntimeProAction } from "@/hooks/useRuntimeProAction";

type RuntimeAdapter = {
  adapterId: string;
  displayName?: string;
  adapterVersion: string;
  authState: string;
};

export type RuntimeDevice = {
  runtimeDeviceId: Id<"runtimeDevices">;
  deviceId: string;
  displayName: string;
  status: "active" | "revoked";
  operatingSystem: string;
  architecture: string;
  platformRelease: string;
  hostVersion: string;
  isOnline: boolean;
  starterPersonaId?: Id<"personas">;
  starterPersonas?: Array<{ adapterId: string; personaId: Id<"personas"> }>;
  runtimePersonas?: Array<{ adapterId: string; personaId: Id<"personas">; needsReconnect: boolean }>;
  lastSeenAt?: number;
  adapters: RuntimeAdapter[];
};

export function RuntimeDeviceCard({
  device,
  isRevoking,
  onRevoke,
  onHide,
  onError,
}: {
  device: RuntimeDevice;
  isRevoking: boolean;
  onRevoke: () => void;
  onHide: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { personas } = useSharedData();
  const navigate = useNavigate();
  const createChat = useMutation(api.chat.mutations.createChat);
  const addBasicPersona = useMutation(api.runtime_host.basic_persona.addBasicPersona);
  const localPro = useRuntimeProAction({ kind: "local-runtime" });
  const [isAdding, setIsAdding] = useState(false);
  const handleAddPersona = async (adapterId: "codex" | "pi", options: { personaId?: Id<"personas">; createAnother?: boolean } = {}) => {
    setIsAdding(true);
    try { navigate(`/app/personas/${await addBasicPersona({ deviceId: device.deviceId, adapterId, ...options })}/edit`); }
    catch (cause) { onError(convexErrorMessage(cause, t("something_went_wrong"))); }
    finally { setIsAdding(false); }
  };
  const starting = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const runtimePersonas = device.runtimePersonas ?? (device.starterPersonas ?? (device.starterPersonaId
    ? [{ adapterId: "codex", personaId: device.starterPersonaId }] : [])).map(entry => ({ ...entry, needsReconnect: false }));
  const personaRows = runtimePersonas.flatMap(binding => {
    const persona = personas?.find(entry => entry._id === binding.personaId);
    return persona ? [{ ...binding, persona }] : [];
  });
  const handleStartChat = async (persona: NonNullable<typeof personas>[number]) => {
    if (starting.current) return;
    starting.current = true;
    setIsStarting(true);
    try {
      const chatId = await launchChat({ createChat, participants: buildPersonaParticipants(persona, Defaults.model) });
      navigate(`/app/chat/${chatId}`);
    } catch (cause) {
      onError(convexErrorMessage(cause, t("something_went_wrong")));
    } finally {
      starting.current = false;
      setIsStarting(false);
    }
  };
  const adapters = device.adapters.filter(adapter => adapter.adapterId === "codex" || adapter.adapterId === "pi");
  const isActive = device.status === "active";
  const statusLabel = !isActive
    ? t("runtime_status_revoked")
    : device.isOnline
      ? t("runtime_status_online")
      : t("runtime_status_offline");

  return (
    <article className="rounded-2xl bg-surface-2 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="relative rounded-xl bg-background p-2 text-primary">
          <Laptop size={18} />
          <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-2 ${
            device.isOnline && isActive ? "bg-green-500" : "bg-foreground/25"
          }`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{device.displayName}</h3>
            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted">
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {device.operatingSystem} {device.platformRelease} · {device.architecture} · Host {device.hostVersion}
          </p>
          {adapters.map(adapter => (
            <p key={adapter.adapterId} className="mt-1 text-xs text-muted">
              {adapter.displayName ?? adapter.adapterId} {adapter.adapterVersion} · {adapter.authState}
            </p>
          ))}
          {device.lastSeenAt && (
            <p className="mt-1 text-[11px] text-muted">
              {t("runtime_last_seen", { time: new Date(device.lastSeenAt).toLocaleString() })}
            </p>
          )}
        </div>
        {(
          <button
            type="button"
            onClick={isActive ? onRevoke : onHide}
            disabled={isRevoking}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {isRevoking ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />}
            {t(isActive ? "runtime_remove_pairing" : "runtime_delete_from_list")}
          </button>
        )}
      </div>
      {isActive && (adapters.length ? adapters : [{ adapterId: "codex" }]).map(adapter => {
        const hasPersona = runtimePersonas.some(entry => entry.adapterId === adapter.adapterId);
        return <button key={adapter.adapterId} type="button"
          onClick={() => localPro.run(() => void handleAddPersona(adapter.adapterId === "pi" ? "pi" : "codex", hasPersona ? { createAnother: true } : {}))}
          disabled={isAdding || localPro.loading}
          className="mt-3 mr-3 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-3 disabled:opacity-50">
          {t(hasPersona ? "runtime_create_another_persona_for_adapter" : "runtime_add_basic_persona_for_adapter",
            { name: "displayName" in adapter ? adapter.displayName ?? adapter.adapterId : "Codex" })}
        </button>;
      })}
      {isActive && personaRows.map(({ persona, adapterId, needsReconnect }) => <div key={persona._id} className="mt-3 flex flex-wrap items-center gap-3">
        {needsReconnect ? <button type="button"
          onClick={() => localPro.run(() => { if (adapterId === "codex" || adapterId === "pi") void handleAddPersona(adapterId, { personaId: persona._id }); })}
          disabled={isAdding || localPro.loading} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {t("runtime_reconnect_persona", { name: persona.displayName })}
        </button> : <>
          <button type="button" onClick={() => localPro.run(() => void handleStartChat(persona))} disabled={isStarting || localPro.loading}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {t("runtime_preview_start_chat", { name: persona.displayName })}
          </button>
          <button type="button" onClick={() => localPro.run(() => navigate(`/app/personas/${persona._id}/edit`))}
            disabled={localPro.loading} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-3 disabled:opacity-50">
            {t("runtime_edit_persona", { name: persona.displayName })}
          </button>
        </>}
      </div>)}
      {localPro.paywall}
    </article>
  );
}
