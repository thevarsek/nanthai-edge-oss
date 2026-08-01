import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2, Paperclip, X } from "lucide-react";
import { remoteMcpErrorMessage } from "@/lib/remoteMcpErrors";
import { RemoteMcpInvocationResult } from "@/components/settings/RemoteMcpInvocationResult";
import { filterRemoteMcpContentForEnabledConnections } from "@/lib/remoteMcp";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import {
  argumentLooksSecret,
  argumentNames,
  resolvedUri,
  type RemoteMcpContentItem,
  type RemoteMcpContentKind,
} from "./remoteMcpContentPickerUtils";

export interface StagedRemoteMcpContext {
  chatId: string;
  invocationId: string;
  connectionId: string;
  label: string;
  serverName: string;
  kind: RemoteMcpContentKind;
}

export function RemoteMcpContentPicker({
  chatId,
  enabledConnectionIds,
  onAttach,
  onClose,
}: {
  chatId: Id<"chats">;
  enabledConnectionIds: readonly string[];
  onAttach: (context: StagedRemoteMcpContext) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const allItems = useQuery(api.mcp.queries.listAvailableContent, {}) as RemoteMcpContentItem[] | undefined;
  const items = useMemo(
    () => filterRemoteMcpContentForEnabledConnections(allItems, enabledConnectionIds),
    [allItems, enabledConnectionIds],
  );
  const invoke = useAction(api.mcp.actions.invoke);
  const respond = useAction(api.mcp.continuation_actions.respondToInput);
  const updateTask = useAction(api.mcp.task_actions.updateTask);
  const [selected, setSelected] = useState<RemoteMcpContentItem>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [invocationId, setInvocationId] = useState<string>();
  const liveInvocation = useQuery(
    api.mcp.queries.getInvocation,
    invocationId ? { invocationId } : "skip",
  );
  const enabledConnectionIdSet = useMemo(() => new Set(enabledConnectionIds), [enabledConnectionIds]);
  const activeSelection = selected && enabledConnectionIdSet.has(selected.connectionId) ? selected : undefined;
  const fields = useMemo(() => activeSelection ? argumentNames(activeSelection) : [], [activeSelection]);
  const containsSecretArgument = fields.some(argumentLooksSecret);

  async function runRequest() {
    if (!activeSelection) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invoke({
        chatId,
        connectionId: activeSelection.connectionId,
        stableKey: activeSelection.stableKey,
        kind: activeSelection.kind,
        ...(activeSelection.kind === "prompt" || activeSelection.kind === "resource_template"
          ? { arguments: values }
          : { uri: resolvedUri(activeSelection, values) }),
      }) as { invocationId?: string };
      if (result.invocationId) setInvocationId(result.invocationId);
    } catch (caught) {
      setError(remoteMcpErrorMessage(caught, t, t("remote_mcp_request_failed")));
    } finally {
      setBusy(false);
    }
  }

  const resultValue = liveInvocation && invocationId
    ? { invocationId, ...liveInvocation }
    : undefined;
  const canAttach = activeSelection && invocationId && liveInvocation?.state === "completed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label={t("close")} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <section className="relative max-h-[82vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1">
            <h2 className="font-semibold">{t("remote_mcp_add_context")}</h2>
            <p className="text-xs text-muted">{t("remote_mcp_add_context_description")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-surface-2"><X size={17} /></button>
        </div>

        {!activeSelection ? (
          <div className="space-y-2">
            {items === undefined && <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}
            {items?.length === 0 && <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">{t("remote_mcp_context_empty")}</p>}
            {items?.map((item) => (
              <button
                key={`${item.connectionId}:${item.stableKey}`}
                type="button"
                onClick={() => { setSelected(item); setValues({}); }}
                className="w-full rounded-xl bg-surface-2 p-3 text-left hover:bg-surface-3"
              >
                <span className="block text-sm font-medium">{item.displayName}</span>
                <span className="block text-xs text-muted">{item.serverName} · {t(`remote_mcp_kind_${item.kind}`)}</span>
                {item.description && <span className="mt-1 block text-xs text-muted line-clamp-2">{item.description}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <button type="button" onClick={() => { setSelected(undefined); setInvocationId(undefined); }} className="text-xs text-primary hover:underline">← {t("remote_mcp_choose_another_item")}</button>
            <div>
              <h3 className="text-sm font-semibold">{activeSelection.displayName}</h3>
              <p className="text-xs text-muted">{activeSelection.serverName} · {t(`remote_mcp_kind_${activeSelection.kind}`)}</p>
            </div>
            {fields.map((field) => (
              <label key={field.name} className="block space-y-1">
                <span className="text-xs font-medium">{field.label}{field.required ? " *" : ""}</span>
                {field.description && <span className="block text-[11px] text-muted">{field.description}</span>}
                <input
                  value={values[field.name] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                />
              </label>
            ))}
            {containsSecretArgument && (
              <p role="alert" className="text-xs text-red-500">{t("remote_mcp_credential_request_blocked")}</p>
            )}
            {activeSelection.kind === "resource" && <p className="rounded-lg bg-surface-2 p-3 text-xs font-mono break-all">{activeSelection.uri}</p>}
            {!invocationId && (
              <button
                type="button"
                disabled={busy || containsSecretArgument || fields.some((field) => field.required && !values[field.name]?.trim())}
                onClick={() => void runRequest()}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? t("remote_mcp_requesting") : activeSelection.kind === "prompt" ? t("remote_mcp_run_prompt") : t("remote_mcp_read_resource")}
              </button>
            )}
            {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
            {resultValue && (
              <RemoteMcpInvocationResult
                value={resultValue}
                busy={busy}
                onResume={async (inputResponses) => {
                  setBusy(true);
                  try { await respond({ invocationId: invocationId ?? "", inputResponses }); }
                  finally { setBusy(false); }
                }}
                onTask={async (id, operation, inputResponses) => {
                  setBusy(true);
                  try { await updateTask({ invocationId: id, operation, inputResponses }); }
                  finally { setBusy(false); }
                }}
              />
            )}
            {canAttach && (
              <button
                type="button"
                onClick={() => {
                  onAttach({
                    chatId: String(chatId),
                    invocationId,
                    connectionId: activeSelection.connectionId,
                    label: activeSelection.displayName,
                    serverName: activeSelection.serverName,
                    kind: activeSelection.kind,
                  });
                  onClose();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
              >
                <Paperclip size={13} /> {t("remote_mcp_attach_to_message")}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
