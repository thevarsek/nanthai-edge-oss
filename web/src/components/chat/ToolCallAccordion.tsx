// components/chat/ToolCallAccordion.tsx
// Expandable tool invocation + result display for all tool types.

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolCall, ToolResult } from "@/hooks/useChat";
import { renderToolResult } from "./ToolResultRenderers.router";

interface Props {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
  /** When true, generation is still running — spinner on open tool calls. */
  isStreaming?: boolean;
}

// Friendly display name map for known tool names
const TOOL_DISPLAY: Record<string, string> = {
  web_search: "Web Search",
  web_browse: "Browse URL",
  load_skill: "Load Skill",
  list_skills: "List Skills",
  create_skill: "Create Skill",
  update_skill: "Update Skill",
  delete_skill: "Delete Skill",
  enable_skill_for_chat: "Enable Skill",
  disable_skill_for_chat: "Disable Skill",
  assign_skill_to_persona: "Assign Skill to Persona",
  remove_skill_from_persona: "Remove Skill from Persona",
  workspace_exec: "Run Code",
  workspace_list_files: "List Files",
  workspace_read_file: "Read File",
  workspace_write_file: "Write File",
  workspace_make_dirs: "Create Directories",
  workspace_export_file: "Export File",
  workspace_reset: "Reset Workspace",
  workspace_import_file: "Import File",
  data_python_exec: "Python Execution",
  generate_chart: "Generate Chart",
  generate_docx: "Generate Document",
  generate_xlsx: "Generate Spreadsheet",
  generate_pptx: "Generate Presentation",
  search_google: "Google Search",
  search_gmail: "Search Gmail",
  read_email: "Read Email",
  send_email: "Send Email",
  list_events: "List Calendar Events",
  create_event: "Create Calendar Event",
  search_drive: "Search Drive",
  read_drive_file: "Read Drive File",
  search_notion: "Search Notion",
  read_notion_page: "Read Notion Page",
};

function getToolName(name: string): string {
  return TOOL_DISPLAY[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function tryPrettyPrint(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

const SKILL_TOOLS = new Set([
  "load_skill",
  "list_skills",
  "create_skill",
  "update_skill",
  "delete_skill",
  "enable_skill_for_chat",
  "disable_skill_for_chat",
  "assign_skill_to_persona",
  "remove_skill_from_persona",
]);

function skillSummary(tc: ToolCall, result?: ToolResult): { title: string; subtitle: string } | null {
  if (!SKILL_TOOLS.has(tc.name)) return null;
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(tc.arguments) as Record<string, unknown>; } catch { /* ignore */ }

  const skillName = typeof args.skillName === "string"
    ? args.skillName
    : typeof args.name === "string"
      ? args.name
      : typeof args.skillId === "string"
        ? args.skillId
        : "Skill";

  switch (tc.name) {
    case "load_skill":
      return { title: `Load ${skillName}`, subtitle: result ? "Skill loaded into the current run." : "Loading skill into the current run." };
    case "list_skills":
      return { title: "List skills", subtitle: result ? "Fetched available skills." : "Fetching visible skills." };
    case "create_skill":
      return { title: `Create ${skillName}`, subtitle: result ? "Created a new user skill." : "Creating a new user skill." };
    case "update_skill":
      return { title: `Update ${skillName}`, subtitle: result ? "Updated skill instructions or metadata." : "Updating skill." };
    case "delete_skill":
      return { title: `Delete ${skillName}`, subtitle: result ? "Deleted the skill." : "Deleting skill." };
    case "enable_skill_for_chat":
      return { title: `Enable ${skillName}`, subtitle: result ? "Enabled for this chat." : "Enabling for this chat." };
    case "disable_skill_for_chat":
      return { title: `Disable ${skillName}`, subtitle: result ? "Disabled for this chat." : "Disabling for this chat." };
    case "assign_skill_to_persona":
      return { title: `Assign ${skillName}`, subtitle: result ? "Assigned to persona." : "Assigning to persona." };
    case "remove_skill_from_persona":
      return { title: `Remove ${skillName}`, subtitle: result ? "Removed from persona." : "Removing from persona." };
    default:
      return null;
  }
}

export function ToolCallAccordion({ toolCalls, toolResults, isStreaming }: Props) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!toolCalls || toolCalls.length === 0) return null;

  const resultMap = new Map<string, ToolResult>();
  for (const r of toolResults ?? []) {
    resultMap.set(r.toolCallId, r);
  }

  const completeCount = toolCalls.filter((tc) => resultMap.has(tc.id)).length;
  const headerText = isStreaming
    ? (toolCalls.length === 1 ? t("using_n_tools", { count: toolCalls.length }) : t("using_n_tools_plural", { count: toolCalls.length }))
    : (toolCalls.length === 1 ? t("used_n_tools", { count: toolCalls.length }) : t("used_n_tools_plural", { count: toolCalls.length }));

  return (
    <div className="mt-2 rounded-xl bg-surface-2/50 border border-border/30 px-2.5 py-2">
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-0.5 py-0.5 text-[11px] font-semibold text-muted text-left"
      >
        <Wrench size={12} />
        <span className="flex-1">{headerText}</span>
        {completeCount > 0 && !isStreaming && <span className="text-[10px] opacity-70">({completeCount})</span>}
        {isExpanded ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )}
      </button>
      {isExpanded && <div className="space-y-1 pt-1.5">
      {toolCalls.map((tc) => {
        const result = resultMap.get(tc.id);
        const isOpen = expanded.has(tc.id);
        const isPending = !result && isStreaming;
        const isError = result?.isError;
        const skillCard = skillSummary(tc, result);

        return (
          <div
            key={tc.id}
            className="rounded-lg overflow-hidden text-xs"
          >
            {/* Header */}
            <button
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
                <AlertCircle size={12} className="text-red-400 shrink-0" />
              ) : result ? (
                <CheckCircle size={12} className="text-green-400 shrink-0" />
              ) : (
                <Wrench size={12} className="text-muted shrink-0" />
              )}

              <span className="font-medium text-muted flex-1">
                {getToolName(tc.name)}
              </span>

              <span className="text-[10px] text-secondary">
                {isPending ? t("running") : isError ? t("error") : result ? t("done") : t("done")}
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

                {/* Arguments */}
                <div>
                  <p className="text-muted mb-1 uppercase tracking-wider text-[10px]">
                    {t("input_label")}
                  </p>
                  <pre className="text-foreground bg-surface-2/50 rounded-lg p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all border border-border/20">
                    {tryPrettyPrint(tc.arguments)}
                  </pre>
                </div>

                {/* Result */}
                {result && (() => {
                  const structured = renderToolResult(tc.name, result.result);
                  if (structured) {
                    return (
                      <div>
                        <p
                          className={[
                            "mb-1 uppercase tracking-wider text-[10px]",
                            isError ? "text-red-400" : "text-muted",
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
                          isError ? "text-red-400" : "text-muted",
                        ].join(" ")}
                      >
                        {isError ? t("error") : t("output_label")}
                      </p>
                         <pre
                           className={[
                             "rounded-lg p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all border border-border/20",
                             isError
                               ? "bg-red-900/20 text-red-300"
                               : "text-foreground bg-surface-2/50",
                        ].join(" ")}
                      >
                        {tryPrettyPrint(result.result)}
                      </pre>
                    </div>
                  );
                })()}

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
