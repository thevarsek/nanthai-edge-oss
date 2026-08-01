import { useMemo, useState } from "react";
import { ExternalLink, Loader2, RotateCw, X } from "lucide-react";
import { RemoteMcpResultPreview } from "./RemoteMcpResultPreview";
import { useTranslation } from "react-i18next";

type InputRequest = {
  method?: string;
  params?: {
    mode?: string;
    message?: string;
    url?: string;
    requestedSchema?: {
      properties?: Record<string, { type?: string; title?: string; description?: string }>;
      required?: string[];
    };
  };
};

const SECRET_FIELD_PATTERN = /(password|passcode|secret|token|credential|api.?key|private.?key)/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeElicitationUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

function requestsSecret(request: InputRequest): boolean {
  const properties = request.params?.requestedSchema?.properties ?? {};
  return SECRET_FIELD_PATTERN.test(request.params?.message ?? "") || Object.entries(properties).some(([field, schema]) =>
    SECRET_FIELD_PATTERN.test(`${field} ${schema.title ?? ""} ${schema.description ?? ""}`),
  );
}

export function RemoteMcpInvocationResult({
  value,
  busy,
  onResume,
  onTask,
}: {
  value: unknown;
  busy: boolean;
  onResume: (inputResponses: unknown, requestState: unknown) => Promise<void>;
  onTask: (invocationId: string, operation: "get" | "update" | "cancel", inputResponses?: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const root = asRecord(value);
  const result = asRecord(root?.result);
  const invocationId = typeof root?.invocationId === "string" ? root.invocationId : undefined;
  const state = typeof root?.state === "string" ? root.state : undefined;
  const taskStatus = typeof root?.taskStatus === "string" ? root.taskStatus : undefined;
  const inputRequests = asRecord(root?.inputRequests) ?? asRecord(result?.inputRequests);
  const requestState = root?.requestState;
  const [values, setValues] = useState<Record<string, Record<string, string | boolean>>>({});
  const requests = useMemo(
    () => Object.entries(inputRequests ?? {}) as Array<[string, InputRequest]>,
    [inputRequests],
  );
  const containsSecretRequest = requests.some(([, request]) => requestsSecret(request));

  function responses(action: "accept" | "decline" | "cancel"): Record<string, unknown> {
    return Object.fromEntries(requests.map(([key, request]) => {
      if (action !== "accept") return [key, { action }];
      const properties = request.params?.requestedSchema?.properties ?? {};
      const content = Object.fromEntries(Object.entries(values[key] ?? {}).map(([field, value]) => {
        const type = properties[field]?.type;
        return [field, (type === "number" || type === "integer") && typeof value === "string"
          ? Number(value)
          : value];
      }));
      return [key, { action, content }];
    }));
  }

  async function answer(action: "accept" | "decline" | "cancel") {
    const inputResponses = responses(action);
    if (state === "task_pending" || taskStatus !== undefined) {
      if (invocationId) await onTask(invocationId, "update", inputResponses);
      return;
    }
    await onResume(inputResponses, requestState);
  }

  return (
    <div className="space-y-3">
      {requests.length > 0 && (
        <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{t("remote_mcp_server_needs_input")}</p>
          {requests.map(([key, request]) => {
            const params = request.params;
            const properties = Object.entries(params?.requestedSchema?.properties ?? {});
            const externalUrl = safeElicitationUrl(params?.url);
            return (
              <div key={key} className="space-y-2">
                <p className="text-xs text-muted">{params?.message ?? key}</p>
                {params?.mode === "url" && externalUrl && (
                  <a href={externalUrl.toString()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    {t("remote_mcp_open_host", { host: externalUrl.host })} <ExternalLink size={11} />
                  </a>
                )}
                {properties.map(([field, schema]) => (
                  <label key={field} className="block space-y-1">
                    <span className="text-xs font-medium">{schema.title ?? field}</span>
                    {schema.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={values[key]?.[field] === true}
                        onChange={(event) => setValues((current) => ({
                          ...current,
                          [key]: { ...current[key], [field]: event.target.checked },
                        }))}
                      />
                    ) : (
                      <input
                        type={schema.type === "number" || schema.type === "integer" ? "number" : "text"}
                        value={String(values[key]?.[field] ?? "")}
                        onChange={(event) => setValues((current) => ({
                          ...current,
                          [key]: { ...current[key], [field]: event.target.value },
                        }))}
                        className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs"
                      />
                    )}
                  </label>
                ))}
              </div>
            );
          })}
          {containsSecretRequest ? (
            <p className="text-[11px] font-medium text-red-500">
              {t("remote_mcp_credential_request_blocked")}
            </p>
          ) : (
            <p className="text-[11px] text-muted">{t("remote_mcp_no_credentials_warning")}</p>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || containsSecretRequest} onClick={() => void answer("accept")} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{t("accept")}</button>
            <button type="button" disabled={busy} onClick={() => void answer("decline")} className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-60">{t("remote_mcp_decline")}</button>
            <button type="button" disabled={busy} onClick={() => void answer("cancel")} className="rounded-lg px-3 py-1.5 text-xs text-red-500 disabled:opacity-60">{t("cancel")}</button>
          </div>
        </div>
      )}
      {state === "task_pending" && invocationId && (
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3">
          <span className="flex-1 text-xs">{t("remote_mcp_task_status", { status: String(result?.status ?? t("remote_mcp_status_working")) })}</span>
          <button type="button" disabled={busy} onClick={() => void onTask(invocationId, "get")} className="inline-flex items-center gap-1 text-xs text-primary disabled:opacity-60">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />} {t("remote_mcp_poll")}
          </button>
          <button type="button" disabled={busy} onClick={() => void onTask(invocationId, "cancel")} className="inline-flex items-center gap-1 text-xs text-red-500 disabled:opacity-60"><X size={12} /> {t("cancel")}</button>
        </div>
      )}
      <RemoteMcpResultPreview value={value} />
    </div>
  );
}
