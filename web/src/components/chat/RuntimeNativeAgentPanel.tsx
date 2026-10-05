import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AgentActivityPanel, type AgentActivityItem } from "./AgentActivityPanel";

type NativeAgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "shutdown"
  | "not_found";

interface RuntimeNativeAgentView {
  origin: "codex_native_agent";
  group: {
    id: Id<"runtimeNativeAgentGroups">;
    messageId: Id<"messages">;
    status: "active" | "completed" | "failed" | "cancelled" | "interrupted";
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
  };
  agents: Array<{
    id: Id<"runtimeNativeAgents">;
    nativeThreadId: string;
    parentNativeThreadId?: string;
    depth: number;
    agentPath?: string;
    nickname?: string;
    role?: string;
    status: NativeAgentStatus;
    prompt?: string;
    latestActivityKind?: string;
    latestActivity?: string;
    statusSummary?: string;
    output?: string;
    error?: string;
    actualModel?: {
      provider?: string;
      modelId: string;
      reportedByAdapter: true;
    };
    reasoningEffort?: string;
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
  }>;
  agentsTruncated: boolean;
}

interface RuntimeNativeAgentPanelProps {
  messageId: Id<"messages">;
}

function isTerminalAgentStatus(status: NativeAgentStatus): boolean {
  return status !== "pending" && status !== "running";
}

export function RuntimeNativeAgentPanel({ messageId }: RuntimeNativeAgentPanelProps) {
  const { t } = useTranslation();
  const view = useQuery(api.runtime_host.native_agents.getForMessage, { messageId }) as
    | RuntimeNativeAgentView
    | null
    | undefined;

  if (view === null || (view && view.origin !== "codex_native_agent")) return null;

  const groupStatus = view?.group.status ?? "active";
  const isActive = groupStatus === "active";
  const agents = view?.agents ?? [];
  const settledCount = agents.filter((agent) => isTerminalAgentStatus(agent.status)).length;
  const items: AgentActivityItem[] = agents.map((agent, index) => {
    const nickname = agent.nickname?.trim();
    const role = agent.role?.trim();
    const title = nickname || role || t("runtime_native_agent_fallback", { index: index + 1 });
    const subtitle = [nickname ? role : undefined, agent.actualModel?.modelId]
      .filter((value): value is string => Boolean(value))
      .join(" · ");

    return {
      id: String(agent.id),
      title,
      subtitle: subtitle || undefined,
      status: agent.status,
      statusLabel: agentStatusLabel(agent.status, t),
      statusSummary: agent.statusSummary,
      prompt: agent.prompt,
      activity: agent.latestActivity,
      output: agent.output,
      error: agent.error,
      isStreaming: agent.status === "running",
    };
  });

  return (
    <AgentActivityPanel
      title={t("runtime_native_agent_origin")}
      status={isActive ? "running" : groupStatus}
      summary={agents.length > 0
        ? isActive ? `(${settledCount}/${agents.length})` : `(${agents.length})`
        : undefined}
      isActive={isActive}
      items={items}
      labels={{
        collapse: t("runtime_native_agent_collapse"),
        expand: t("runtime_native_agent_expand"),
        prompt: t("runtime_native_agent_prompt"),
        activity: t("runtime_native_agent_activity"),
        output: t("runtime_native_agent_output"),
      }}
      emptyLabel={t("runtime_native_agent_waiting")}
      footerLabel={view?.agentsTruncated ? t("runtime_native_agent_truncated") : undefined}
      testId="runtime-native-agent-panel"
      boundedContent
    />
  );
}

function agentStatusLabel(status: NativeAgentStatus, t: TFunction): string {
  switch (status) {
    case "pending": return t("queued");
    case "running": return t("running");
    case "completed": return t("completed");
    case "failed": return t("failed");
    case "interrupted": return t("runtime_native_agent_interrupted");
    case "shutdown": return t("runtime_native_agent_shutdown");
    case "not_found": return t("runtime_native_agent_not_found");
  }
}
