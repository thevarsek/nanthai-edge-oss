import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Focus, Pencil, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import type { MemoryDoc } from "../MemoryPageHelpers";
import { MemoryGraphCanvas } from "./MemoryGraphCanvas";

export interface MemoryGraphNode {
  id: Id<"memories">;
  content: string;
  category: MemoryDoc["category"] extends infer T ? Exclude<T, undefined> : never;
  retrievalMode: MemoryDoc["retrievalMode"] extends infer T ? Exclude<T, undefined> : never;
  tags: string[];
  importanceScore: number;
  reinforcementCount: number;
  lastReinforcedAt?: number;
  updatedAt: number;
  isSuperseded: boolean;
  supersededByMemoryId?: Id<"memories">;
}

export interface MemoryGraphEdge {
  id: Id<"memoryRelationships">;
  sourceId: Id<"memories">;
  targetId: Id<"memories">;
  kind: "related" | "sameTopic" | "supersedes";
  confidence: number;
}

export function MemoryGraphExplorer({
  searchText,
  category,
  retrievalMode,
  onEdit,
  onDelete,
}: {
  searchText: string;
  category?: string;
  retrievalMode?: string;
  onEdit: (memory: MemoryGraphNode) => void;
  onDelete: (id: Id<"memories">) => void;
}) {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<Id<"memories"> | null>(null);
  const [mode, setMode] = useState<"all" | "neighborhood">("all");
  const liveGraph = useQuery(api.memory.graph.get, {
    mode,
    selectedMemoryId: mode === "neighborhood" ? selectedId ?? undefined : undefined,
    category: category as MemoryGraphNode["category"] | undefined,
    retrievalMode: retrievalMode as MemoryGraphNode["retrievalMode"] | undefined,
    text: searchText.trim() || undefined,
  });
  const [transitionGraph, setTransitionGraph] = useState(liveGraph);
  const graph = liveGraph ?? transitionGraph;
  const isUpdating = liveGraph === undefined && transitionGraph !== undefined;
  const selected = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedId) ?? null,
    [graph, selectedId],
  );
  const relationshipCount = graph?.edges.filter(
    (edge) => edge.sourceId === selectedId || edge.targetId === selectedId,
  ).length ?? 0;

  if (graph === undefined) {
    return <div className="flex min-h-[440px] items-center justify-center rounded-2xl bg-surface-2"><LoadingSpinner /></div>;
  }
  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-[62vh] min-h-[440px] flex-col items-center justify-center rounded-2xl border border-border/50 bg-surface-2 px-6 text-center">
        <p className="text-sm font-medium">{t("memory_graph_empty", { defaultValue: "No connected memories match these filters" })}</p>
        <p className="mt-1 max-w-sm text-xs text-muted">{t("memory_graph_empty_hint", { defaultValue: "Independent memories are still valid. Try clearing filters or switch back to List." })}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <MemoryGraphCanvas
        nodes={graph.nodes as MemoryGraphNode[]}
        edges={graph.edges as MemoryGraphEdge[]}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
      />
      <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
        <span className="rounded-full border border-border/60 bg-surface-1/85 px-2.5 py-1 text-[11px] text-muted backdrop-blur">
          {graph.nodes.length} {t("memory_graph_nodes", { defaultValue: "memories" })}
        </span>
        <span className="rounded-full border border-border/60 bg-surface-1/85 px-2.5 py-1 text-[11px] text-muted backdrop-blur">
          {graph.edges.length} {t("memory_graph_edges", { defaultValue: "connections" })}
        </span>
        {(graph.truncated.candidates || graph.truncated.nodes || graph.truncated.edges) && (
          <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-300 backdrop-blur">
            {t("memory_graph_truncated", { defaultValue: "Showing a bounded view" })}
          </span>
        )}
        {isUpdating && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-1/85 px-2.5 py-1 text-[11px] text-muted backdrop-blur">
            <LoadingSpinner className="size-3" />
            {t("memory_graph_updating", { defaultValue: "Updating graph" })}
          </span>
        )}
      </div>
      {selected && (
        <aside className="absolute inset-x-3 bottom-14 max-h-[80%] overflow-y-auto rounded-xl border border-border/70 bg-surface-1/95 p-4 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-relaxed">{selected.content}</p>
              {selected.isSuperseded && (
                <span className="mt-2 inline-flex rounded-full bg-surface-3 px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
                  {t("memory_graph_superseded", { defaultValue: "Superseded · read only" })}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="rounded-md p-1 text-muted hover:text-foreground" aria-label={t("close")}>
              <X size={15} />
            </button>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-xs">
            <dt className="text-muted">{t("category", { defaultValue: "Category" })}</dt>
            <dd className="text-right">{categoryLabel(selected.category, t)}</dd>
            <dt className="text-muted">{t("memory_retrieval_mode", { defaultValue: "Retrieval mode" })}</dt>
            <dd className="text-right">{retrievalModeLabel(selected.retrievalMode, t)}</dd>
            <dt className="text-muted">{t("memory_graph_importance", { defaultValue: "Importance" })}</dt>
            <dd className="text-right">{Math.round(selected.importanceScore * 100)}%</dd>
            <dt className="text-muted">{t("memory_graph_reinforced", { defaultValue: "Reinforced" })}</dt>
            <dd className="text-right">{selected.reinforcementCount}</dd>
            <dt className="text-muted">{t("memory_graph_connections", { defaultValue: "Connections" })}</dt>
            <dd className="text-right">{relationshipCount}</dd>
            {selected.supersededByMemoryId && (
              <>
                <dt className="text-muted">{t("memory_graph_replaced_by", { defaultValue: "Replaced by" })}</dt>
                <dd className="truncate text-right font-mono text-[10px]">{selected.supersededByMemoryId}</dd>
              </>
            )}
            <dt className="text-muted">{t("last_updated", { defaultValue: "Last updated" })}</dt>
            <dd className="text-right">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(selected.updatedAt)}</dd>
          </dl>
          <div className="mt-4 flex gap-2">
            {mode === "all" ? (
              <button
                type="button"
                onClick={() => {
                  setTransitionGraph(graph);
                  setMode("neighborhood");
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-3 px-3 py-2 text-xs hover:text-accent"
              >
                <Focus size={14} />
                {t("memory_graph_focus", { defaultValue: "Focus neighborhood" })}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTransitionGraph(graph);
                  setMode("all");
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-3 px-3 py-2 text-xs hover:text-accent"
              >
                <Focus size={14} />
                {t("memory_graph_show_all", { defaultValue: "Show full graph" })}
              </button>
            )}
            {!selected.isSuperseded && (
              <button type="button" onClick={() => onEdit(selected)} className="rounded-lg bg-surface-3 p-2 text-muted hover:text-foreground" aria-label={t("edit")}>
                <Pencil size={15} />
              </button>
            )}
            <button type="button" onClick={() => onDelete(selected.id)} className="rounded-lg bg-red-400/10 p-2 text-red-400 hover:bg-red-400/20" aria-label={t("delete")}>
              <Trash2 size={15} />
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

function categoryLabel(category: MemoryGraphNode["category"], t: ReturnType<typeof useTranslation>["t"]): string {
  const key = `memory_cat_${category}`;
  return t(key, { defaultValue: category });
}

function retrievalModeLabel(mode: MemoryGraphNode["retrievalMode"], t: ReturnType<typeof useTranslation>["t"]): string {
  const keys: Record<MemoryGraphNode["retrievalMode"], string> = {
    alwaysOn: "memory_retrieval_always_on",
    contextual: "memory_retrieval_contextual",
    disabled: "memory_retrieval_ignored",
  };
  return t(keys[mode], { defaultValue: mode });
}
