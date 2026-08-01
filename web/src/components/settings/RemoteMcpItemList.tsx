import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RemoteMcpInvocationResult } from "./RemoteMcpInvocationResult";
import { remoteMcpErrorMessage } from "@/lib/remoteMcpErrors";

export interface RemoteMcpItem {
  stableKey: string;
  kind: "tool" | "prompt" | "resource" | "resource_template";
  name: string;
  displayName?: string;
  title?: string;
  description?: string;
  uri?: string;
  uriTemplate?: string;
  decision: "allowed" | "disabled";
  disabledReason?: string;
}

export function RemoteMcpItemList({
  items,
  onDecision,
  onInvoke,
  onResume,
  onTask,
}: {
  items: RemoteMcpItem[];
  onDecision: (stableKey: string, decision: "allowed" | "disabled") => Promise<void>;
  onInvoke: (item: RemoteMcpItem, values: {
    arguments?: unknown;
    uri?: string;
    requestState?: unknown;
    inputResponses?: unknown;
  }) => Promise<unknown>;
  onResume: (invocationId: string, inputResponses: unknown) => Promise<unknown>;
  onTask: (invocationId: string, operation: "get" | "update" | "cancel", inputResponses?: unknown) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<string>();
  const [testKey, setTestKey] = useState<string>();
  const [testInput, setTestInput] = useState("{}");
  const [testResult, setTestResult] = useState<unknown>();
  const groups = ["tool", "prompt", "resource", "resource_template"] as const;

  async function changeDecision(item: RemoteMcpItem) {
    setBusyKey(item.stableKey);
    try {
      await onDecision(item.stableKey, item.decision === "allowed" ? "disabled" : "allowed");
    } finally {
      setBusyKey(undefined);
    }
  }

  async function runTest(item: RemoteMcpItem) {
    setBusyKey(item.stableKey);
    setTestResult(undefined);
    try {
      const values = item.kind === "resource" || item.kind === "resource_template"
        ? { uri: testInput.trim() || item.uri }
        : { arguments: JSON.parse(testInput) as unknown };
      const result = await onInvoke(item, values);
      setTestResult(result);
    } catch (error) {
      setTestResult({ error: remoteMcpErrorMessage(error, t, t("remote_mcp_request_failed_short")) });
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <div className="space-y-5">
      {groups.map((kind) => {
        const entries = items.filter((item) => item.kind === kind);
        if (entries.length === 0) return null;
        return (
          <section key={kind} className="space-y-2">
            <h4 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t(`remote_mcp_kind_${kind}_plural`)}</h4>
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-surface-2">
              {entries.map((item) => (
                <div key={item.stableKey} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.displayName || item.title || item.name}</p>
                      {item.description && <p className="mt-0.5 text-xs text-muted line-clamp-2">{item.description}</p>}
                      {item.disabledReason && <p className="mt-1 text-xs text-red-500">{t("remote_mcp_unavailable_reason", { reason: item.disabledReason })}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={busyKey === item.stableKey || Boolean(item.disabledReason)}
                      onClick={() => void changeDecision(item)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${item.decision === "allowed" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-surface-3 text-muted"}`}
                    >
                      {busyKey === item.stableKey ? <Loader2 size={13} className="animate-spin" /> : item.decision === "allowed" ? t("remote_mcp_allowed") : t("disabled")}
                    </button>
                  </div>
                  {item.decision === "allowed" && (
                    <button
                      type="button"
                      onClick={() => {
                        setTestKey(testKey === item.stableKey ? undefined : item.stableKey);
                        setTestInput(item.kind === "resource" ? item.uri ?? "" : item.kind === "resource_template" ? item.uriTemplate ?? "" : "{}");
                        setTestResult(undefined);
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Play size={12} /> {t("remote_mcp_test")}
                    </button>
                  )}
                  {testKey === item.stableKey && (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={testInput}
                        onChange={(event) => setTestInput(event.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs"
                        aria-label={item.kind.includes("resource") ? t("remote_mcp_resource_uri") : t("remote_mcp_json_arguments")}
                      />
                      <button
                        type="button"
                        disabled={busyKey === item.stableKey}
                        onClick={() => void runTest(item)}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {t("remote_mcp_run_request")}
                      </button>
                      {testResult !== undefined && (
                        <RemoteMcpInvocationResult
                          value={testResult}
                          busy={busyKey === item.stableKey}
                          onResume={async (inputResponses, requestState) => {
                            setBusyKey(item.stableKey);
                            try {
                              const current = testResult as { invocationId?: unknown } | undefined;
                              const invocationId = typeof current?.invocationId === "string"
                                ? current.invocationId
                                : undefined;
                              setTestResult(invocationId
                                ? await onResume(invocationId, inputResponses)
                                : await onInvoke(item, {
                                    arguments: item.kind === "tool" || item.kind === "prompt" ? JSON.parse(testInput) as unknown : undefined,
                                    uri: item.kind.includes("resource") ? testInput : undefined,
                                    requestState,
                                    inputResponses,
                                  }));
                            } finally {
                              setBusyKey(undefined);
                            }
                          }}
                          onTask={async (invocationId, operation, inputResponses) => {
                            setBusyKey(item.stableKey);
                            try {
                              setTestResult(await onTask(invocationId, operation, inputResponses));
                            } finally {
                              setBusyKey(undefined);
                            }
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
