// components/chat/ToolCallAccordion.tsx
// Expandable tool invocation + result display for all tool types.

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolCall, ToolResult } from "@/hooks/useChat";
import { renderToolResult } from "./ToolResultRenderers.router";
import {
  formatToolPayloadForDisplay,
  getToolName,
  skillSummary,
} from "./toolCallDisplay";

interface Props {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
  /** When true, generation is still running — spinner on open tool calls. */
  isStreaming?: boolean;
  activeToolCallIds?: string[];
  loadedSkillIds?: string[];
  usedIntegrationIds?: string[];
}

export function ToolCallAccordion({
  toolCalls,
  toolResults,
  isStreaming,
  activeToolCallIds,
  loadedSkillIds,
  usedIntegrationIds,
}: Props) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [technicalExpanded, setTechnicalExpanded] = useState<Set<string>>(new Set());
  const hasTraceMetadata = (loadedSkillIds?.length ?? 0) > 0 || (usedIntegrationIds?.length ?? 0) > 0;

  if ((!toolCalls || toolCalls.length === 0) && !hasTraceMetadata) return null;

  const resultMap = new Map<string, ToolResult>();
  for (const r of toolResults ?? []) {
    resultMap.set(r.toolCallId, r);
  }

  const activeToolCallIdSet = activeToolCallIds === undefined
    ? null
    : new Set(activeToolCallIds);

  const completeCount = toolCalls.filter((toolCall) =>
    resultMap.has(toolCall.id)
    || (activeToolCallIdSet !== null && !activeToolCallIdSet.has(toolCall.id))
  ).length;
  const headerText = toolCalls.length > 0
    ? (isStreaming
      ? (toolCalls.length === 1 ? t("using_n_tools", { count: toolCalls.length }) : t("using_n_tools_plural", { count: toolCalls.length }))
      : (toolCalls.length === 1 ? t("used_n_tools", { count: toolCalls.length }) : t("used_n_tools_plural", { count: toolCalls.length })))
    : t("orchestration");

  return (
    <div className="mt-2 rounded-xl bg-surface-2/50 border border-border/30 px-2.5 py-2">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-0.5 py-0.5 text-[11px] font-semibold text-muted text-left"
      >
        <Wrench size={12} />
        <span className="flex-1">{headerText}</span>
        {completeCount > 0 && (
          <span className="text-[10px] opacity-70">({completeCount}/{toolCalls.length})</span>
        )}
        {isExpanded ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )}
      </button>
      {isExpanded && <div className="space-y-1 pt-1.5">
      {hasTraceMetadata && (
        <div className="rounded-lg border border-border/20 bg-surface-2/30 px-3 py-2 text-[11px] space-y-2">
          {(loadedSkillIds?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-foreground">{t("loaded_skills")}</p>
              <p className="text-muted mt-0.5 break-all">{loadedSkillIds!.join(", ")}</p>
            </div>
          )}
          {(usedIntegrationIds?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-foreground">{t("used_integrations")}</p>
              <p className="text-muted mt-0.5 break-all">{usedIntegrationIds!.join(", ")}</p>
            </div>
          )}
        </div>
      )}
      {toolCalls.map((tc) => {
        const result = resultMap.get(tc.id);
        const isOpen = expanded.has(tc.id);
        const isPending = Boolean(isStreaming) && (
          activeToolCallIdSet === null
            ? !result
            : activeToolCallIdSet.has(tc.id)
        );
        const isImplicitlyComplete = Boolean(isStreaming)
          && activeToolCallIdSet !== null
          && !activeToolCallIdSet.has(tc.id);
        const isComplete = Boolean(result) || isImplicitlyComplete;
        const isError = result?.isError;
        const skillCard = skillSummary(tc, result);
        const toolName = getToolName(tc.name, (key) => t(key));

        return (
          <div
            key={tc.id}
            className="rounded-lg overflow-hidden text-xs"
          >
            {/* Header */}
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(tc.id)) next.delete(tc.id);
                  else next.add(tc.id);
                  return next;
                })
              }
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-3/50 rounded-md transition-colors"
            >
              {/* Status icon */}
              {isPending ? (
                <Loader size={12} className="text-primary animate-spin shrink-0" />
              ) : isError ? (
                <AlertCircle size={12} className="text-red-600 dark:text-red-400 shrink-0" />
              ) : isComplete ? (
                <CheckCircle size={12} className="text-green-400 shrink-0" />
              ) : (
                <Wrench size={12} className="text-muted shrink-0" />
              )}

              <span className="font-medium text-muted flex-1">
                {toolName}
              </span>

              <span className="text-[10px] text-secondary">
                {isPending ? t("running") : isError ? t("error") : isComplete ? t("done") : t("waiting_to_resume")}
              </span>

              {isOpen ? (
                <ChevronDown size={12} className="text-muted shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-muted shrink-0" />
              )}
            </button>

            {/* Expanded body */}
            {isOpen && (
              <div className="px-2 pt-1 pb-2 space-y-2">
                {skillCard && (
                  <div className="rounded-lg border border-border/20 bg-surface-2/30 px-3 py-2">
                    <p className="text-[11px] font-semibold text-foreground">{skillCard.title}</p>
                    <p className="text-[10px] text-muted mt-0.5">{skillCard.subtitle}</p>
                  </div>
                )}
                {!skillCard && (
                  <p className="rounded-lg border border-border/20 bg-surface-2/30 px-3 py-2 text-[11px] text-muted">
                    {isPending ? "Tool is running…" : isError ? "Tool returned an error." : isComplete ? "Completed successfully." : "Waiting to resume."}
                  </p>
                )}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted transition-colors hover:text-foreground"
                  aria-expanded={technicalExpanded.has(tc.id)}
                  aria-label={`${t("details")}: ${toolName}`}
                  onClick={() => setTechnicalExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(tc.id)) next.delete(tc.id);
                    else next.add(tc.id);
                    return next;
                  })}
                >
                  {technicalExpanded.has(tc.id) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {t("details")}
                </button>

                {technicalExpanded.has(tc.id) && <div className="space-y-2">
                  <div>
                    <p className="text-muted mb-1 uppercase tracking-wider text-[10px]">
                      {t("input_label")}
                    </p>
                    <pre className="text-foreground bg-surface-2/50 rounded-lg p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all border border-border/20">
                      {formatToolPayloadForDisplay(tc.arguments)}
                    </pre>
                  </div>

                  {result && (() => {
                  const structured = renderToolResult(tc.name, result.result);
                  if (structured) {
                    return (
                      <div>
                        <p
                          className={[
                            "mb-1 uppercase tracking-wider text-[10px]",
                            isError ? "text-red-700 dark:text-red-300" : "text-muted",
                          ].join(" ")}
                        >
                          {isError ? t("error") : t("output_label")}
                        </p>
                        {structured}
                      </div>
                    );
                  }
                  return (
                    <div>
                      <p
                        className={[
                          "mb-1 uppercase tracking-wider text-[10px]",
                          isError ? "text-red-700 dark:text-red-300" : "text-muted",
                        ].join(" ")}
                      >
                        {isError ? t("error") : t("output_label")}
                      </p>
                         <pre
                           className={[
                             "rounded-lg p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all border border-border/20",
                             isError
                               ? "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200"
                               : "text-foreground bg-surface-2/50",
                        ].join(" ")}
                      >
                        {formatToolPayloadForDisplay(result.result)}
                      </pre>
                    </div>
                  );
                  })()}
                </div>}

                {isPending && (
                  <p className="text-muted italic">{t("running")}...</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>}
    </div>
  );
}
