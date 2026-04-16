import { useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Check, Trash2, List, Brain, Plus, Cpu, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Toggle } from "@/components/shared/Toggle";
import { ModelPicker } from "@/components/shared/ModelPicker";
import { ProGateWrapper } from "@/hooks/useProGate";
import { useSharedData } from "@/hooks/useSharedData";
import { usePreferenceBuffer } from "@/hooks/usePreferenceBuffer";
import {
  MemoryEditorDialog,
  ImportReviewDialog,
} from "./MemoryPageDialogs";
import {
  MemoryItemRow,
  type ImportedMemoryCandidate,
  type MemoryDoc,
} from "./MemoryPageHelpers";

const DEFAULT_MEMORY_MODEL = "openai/gpt-4.1-mini";
const MEMORY_CATEGORY_ORDER = [
  "identity",
  "preferences",
  "work",
  "goals",
  "background",
  "writingStyle",
  "relationships",
  "skills",
  "tools",
  "logistics",
] as const;
const MEMORY_RETRIEVAL_ORDER = ["alwaysOn", "contextual", "disabled"] as const;
const MEMORY_SCOPE_ORDER = ["allPersonas", "selectedPersonas"] as const;

type MemoryFilterState = {
  category?: string;
  retrievalMode?: string;
  scopeType?: string;
  showPending?: boolean;
};

function memoryCategoryLabel(category: string, t: (key: string) => string): string {
  switch (category) {
    case "writingStyle":
      return t("memory_cat_writing_style");
    default:
      return t(`memory_cat_${category}`) || (category.charAt(0).toUpperCase() + category.slice(1));
  }
}

function memoryRetrievalLabel(retrievalMode: string, t: (key: string) => string): string {
  switch (retrievalMode) {
    case "alwaysOn":
      return t("memory_retrieval_always_on");
    case "contextual":
      return t("memory_retrieval_contextual");
    case "disabled":
      return t("memory_retrieval_ignored");
    default:
      return retrievalMode;
  }
}

function memoryScopeLabel(scopeType: string, t: (key: string) => string): string {
  switch (scopeType) {
    case "allPersonas":
      return t("memory_scope_all_personas");
    case "selectedPersonas":
      return t("memory_scope_persona_specific");
    default:
      return scopeType;
  }
}

function shortModelName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

// ─── Page content ──────────────────────────────────────────────────────────

function MemoryPageContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { prefs } = useSharedData();
  const { updatePreference, updatePreferenceImmediate } = usePreferenceBuffer();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [filterState, setFilterState] = useState<MemoryFilterState>({});
  const [deleteTarget, setDeleteTarget] = useState<Id<"memories"> | null>(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [showAllMemories, setShowAllMemories] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [editingMemory, setEditingMemory] = useState<MemoryDoc | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importCandidates, setImportCandidates] = useState<ImportedMemoryCandidate[]>([]);

  const memories = useQuery(api.memory.operations.list, {});

  const createUploadUrl = useMutation(api.chat.mutations.createUploadUrl);
  const togglePin = useMutation(api.memory.operations.togglePin);
  const removeMem = useMutation(api.memory.operations.remove);
  const approve = useMutation(api.memory.operations.approve);
  const reject = useMutation(api.memory.operations.reject);
  const deleteAllMem = useMutation(api.memory.operations.deleteAll);
  const approveAll = useMutation(api.memory.operations.approveAll);
  const rejectAll = useMutation(api.memory.operations.rejectAll);
  const commitImportedMemories = useMutation(api.memory.operations.commitImportedMemories);
  const extractImportCandidates = useAction(api.memory.operations.extractImportCandidates);

  const isMemoryEnabled = prefs?.isMemoryEnabled ?? true;
  const memoryGatingMode = (prefs?.memoryGatingMode as string | undefined) ?? "automatic";
  const memoryExtractionModelId = (prefs?.memoryExtractionModelId as string | undefined) ?? DEFAULT_MEMORY_MODEL;

  type MemoryWithStatus = typeof memories extends readonly (infer T)[] | undefined | null
    ? T
    : never;

  const allMemories: MemoryDoc[] = ((memories ?? []) as MemoryWithStatus[]).map(
    (m) => m as unknown as MemoryDoc,
  );

  const savedMemories = useMemo(
    () => allMemories.filter((memory) => memory.isPending !== true),
    [allMemories],
  );

  const availableCategories = useMemo(
    () =>
      MEMORY_CATEGORY_ORDER.filter((category) =>
        savedMemories.some((memory) => memory.category === category),
      ),
    [savedMemories],
  );

  const availableRetrievalModes = useMemo(
    () =>
      MEMORY_RETRIEVAL_ORDER.filter((retrievalMode) =>
        savedMemories.some((memory) => memory.retrievalMode === retrievalMode),
      ),
    [savedMemories],
  );

  const availableScopeTypes = useMemo(
    () =>
      MEMORY_SCOPE_ORDER.filter((scopeType) =>
        savedMemories.some((memory) => memory.scopeType === scopeType),
      ),
    [savedMemories],
  );

  const pendingMemories = useMemo(
    () => allMemories.filter((memory) => memory.isPending === true),
    [allMemories],
  );

  const normalizedSearchText = searchText.trim().toLowerCase();
  const matchesSearch = (memory: MemoryDoc) =>
    !normalizedSearchText ||
    memory.content.toLowerCase().includes(normalizedSearchText) ||
    (memory.tags ?? []).some((tag) => tag.toLowerCase().includes(normalizedSearchText));

  const displayedMemories = savedMemories.filter((memory) => {
    if (filterState.category && memory.category !== filterState.category) return false;
    if (filterState.retrievalMode && memory.retrievalMode !== filterState.retrievalMode) return false;
    if (filterState.scopeType && memory.scopeType !== filterState.scopeType) return false;
    return matchesSearch(memory);
  });
  const filteredPendingMemories = pendingMemories.filter(matchesSearch);

  const pendingCount = pendingMemories.length;
  const savedCount = savedMemories.length;
  const alwaysOnMemories = displayedMemories.filter((memory) => memory.retrievalMode === "alwaysOn");
  const contextualMemories = displayedMemories.filter((memory) => memory.retrievalMode === "contextual");
  const ignoredMemories = displayedMemories.filter((memory) => memory.retrievalMode === "disabled");

  const gatingModeFooter =
    memoryGatingMode === "automatic"
      ? t("memory_mode_automatic_footer")
      : memoryGatingMode === "manualConfirm"
        ? t("memory_mode_ask_first_footer")
        : t("memory_mode_dont_save_footer");

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setImportError(null);
    try {
      const uploadedFiles = await Promise.all(Array.from(files).map(async (file) => {
        const uploadUrl = await createUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        return {
          storageId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
        };
      }));

      const candidates = await extractImportCandidates({
        files: uploadedFiles,
        extractionModel: memoryExtractionModelId,
      });
      setImportCandidates(candidates as unknown as ImportedMemoryCandidate[]);
      setShowAllMemories(true);
    } catch (error) {
      setImportError(
        t("upload_failed_arg", {
          var1: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCommitImportedMemories = async (candidates: ImportedMemoryCandidate[]) => {
    await commitImportedMemories({
      memories: candidates.map((candidate) => ({
        content: candidate.content,
        category: candidate.category,
        retrievalMode: candidate.retrievalMode as Parameters<typeof commitImportedMemories>[0]["memories"][number]["retrievalMode"],
        scopeType: candidate.scopeType as Parameters<typeof commitImportedMemories>[0]["memories"][number]["scopeType"],
        personaIds: candidate.scopeType === "selectedPersonas" ? (candidate.personaIds ?? []) : [],
        tags: candidate.tags ?? [],
        isPinned: candidate.isPinned ?? false,
        sourceFileName: candidate.sourceFileName ?? undefined,
        importanceScore: candidate.importanceScore ?? undefined,
        confidenceScore: candidate.confidenceScore ?? undefined,
      })),
    });
    setImportCandidates([]);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => void handleImportFiles(event.target.files)}
      />
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button
          onClick={() => navigate("/app/settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{t("memory")}</h1>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors"
          title={t("upload")}
        >
          <Upload size={16} />
        </button>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-colors"
        >
          <Plus size={14} strokeWidth={2.5} />
          {t("add_memory")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {importError && (
            <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-400">
              {importError}
            </div>
          )}

          {/* Section 1: Enable Memory toggle */}
          <div className="space-y-1">
            <div className="rounded-2xl bg-surface-2 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Brain size={16} className="text-accent flex-shrink-0" />
                  <span className="text-sm font-medium">{t("memory_enable")}</span>
                </div>
                <Toggle
                  checked={isMemoryEnabled}
                  onChange={(v) => updatePreference({ isMemoryEnabled: v })}
                />
              </div>
            </div>
            <p className="text-xs text-muted px-1">{t("memory_enable_footer")}</p>
          </div>

          {isMemoryEnabled && (
            <>
              {/* Section 2: Saving Mode */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("memory_saving_mode")}</p>
                <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                  {([
                    { value: "automatic", label: t("memory_mode_automatic") },
                    { value: "manualConfirm", label: t("memory_mode_ask_first") },
                    { value: "disabled", label: t("memory_mode_dont_save") },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updatePreference({ memoryGatingMode: opt.value })}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-3 transition-colors text-left"
                    >
                      <span className="text-sm">{opt.label}</span>
                      {memoryGatingMode === opt.value && (
                        <Check size={16} strokeWidth={2.5} className="text-accent flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted px-1">{gatingModeFooter}</p>
              </div>

              {/* Section 3: Extraction Model */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("memory_extraction_model")}</p>
                <div className="rounded-2xl bg-surface-2 overflow-hidden">
                  <button
                    onClick={() => setShowModelPicker(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
                  >
                    <Cpu size={16} className="text-accent flex-shrink-0" />
                    <span className="text-sm flex-1">{t("memory_model_label")}</span>
                    <span className="text-xs text-muted truncate max-w-[180px]">
                      {shortModelName(memoryExtractionModelId)}
                    </span>
                    <ChevronRight size={14} className="text-muted flex-shrink-0" />
                  </button>
                </div>
                <p className="text-xs text-muted px-1">{t("memory_extraction_model_footer")}</p>
              </div>

              {/* Section 4: Statistics */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("memory_statistics")}</p>
                <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm">{t("memory_saved_count")}</span>
                    <span className="text-sm text-muted">{memories === undefined ? "\u2014" : savedCount}</span>
                  </div>
                  {pendingCount > 0 && (
                    <button
                      onClick={() => {
                        setShowAllMemories(true);
                        setFilterState({ showPending: true });
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-3 transition-colors"
                    >
                      <span className="text-sm">{t("memory_pending_review")}</span>
                      <span className="text-sm text-accent font-medium">{pendingCount}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Section 5: View All Memories nav row */}
              <div className="rounded-2xl bg-surface-2 overflow-hidden">
                <button
                  onClick={() => setShowAllMemories((v) => !v)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
                >
                  <List size={16} className="text-accent flex-shrink-0" />
                  <span className="text-sm flex-1">{t("memory_view_all")}</span>
                  <ChevronRight
                    size={14}
                    className={`text-muted transition-transform ${showAllMemories ? "rotate-90" : ""}`}
                  />
                </button>
              </div>

              {/* Inline memory list (expanded) */}
              {showAllMemories && (
                <>
                  {/* Pending review banner */}
                  {pendingCount > 0 && (
                    <div className="rounded-2xl bg-amber-400/10 border border-amber-400/20 p-4 flex items-center justify-between">
                      <p className="text-sm text-amber-400">{t("pending_review_count_one", { count: pendingCount, defaultValue: `${pendingCount} ${pendingCount === 1 ? "memory" : "memories"} awaiting review` })}</p>
                      <div className="flex gap-2">
                        <button onClick={() => void rejectAll({})} className="px-3 py-1 text-xs rounded-lg bg-surface-3 hover:text-red-400 transition-colors">
                          {t("reject_all")}
                        </button>
                        <button onClick={() => void approveAll({})} className="px-3 py-1 text-xs rounded-lg bg-green-400/15 text-green-400 hover:bg-green-400/25 transition-colors">
                          {t("approve_all")}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quick filters */}
                  <div className="space-y-2">
                    <input
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      placeholder="Search memories or tags"
                      className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm focus:outline-none focus:border-accent"
                    />
                    <div className="-mx-1 overflow-x-auto pb-1">
                      <div className="flex min-w-max gap-1.5 px-1">
                         <button
                          onClick={() => setFilterState({})}
                         className={[
                             "px-3 py-1.5 rounded-full text-xs transition-colors whitespace-nowrap",
                             !filterState.category && !filterState.retrievalMode && !filterState.scopeType && !filterState.showPending
                               ? "bg-accent text-white"
                               : "bg-surface-2 text-muted hover:text-foreground",
                           ].join(" ")}
                         >
                           {t("all")}
                        </button>
                        {availableRetrievalModes.map((retrievalMode) => (
                          <button
                            key={retrievalMode}
                            onClick={() => setFilterState((current) => ({
                              ...current,
                              showPending: undefined,
                              retrievalMode: current.retrievalMode === retrievalMode ? undefined : retrievalMode,
                            }))}
                            className={[
                              "px-3 py-1.5 rounded-full text-xs transition-colors whitespace-nowrap",
                              filterState.retrievalMode === retrievalMode
                                ? "bg-accent text-white"
                                : "bg-surface-2 text-muted hover:text-foreground",
                            ].join(" ")}
                          >
                            {memoryRetrievalLabel(retrievalMode, t)}
                          </button>
                        ))}
                        {availableScopeTypes.map((scopeType) => (
                          <button
                            key={scopeType}
                            onClick={() => setFilterState((current) => ({
                              ...current,
                              showPending: undefined,
                              scopeType: current.scopeType === scopeType ? undefined : scopeType,
                            }))}
                            className={[
                              "px-3 py-1.5 rounded-full text-xs transition-colors whitespace-nowrap",
                              filterState.scopeType === scopeType
                                ? "bg-accent text-white"
                                : "bg-surface-2 text-muted hover:text-foreground",
                            ].join(" ")}
                          >
                            {memoryScopeLabel(scopeType, t)}
                          </button>
                        ))}
                        {availableCategories.map((category) => (
                          <button
                            key={category}
                            onClick={() => setFilterState((current) => ({
                              ...current,
                              showPending: undefined,
                              category: current.category === category ? undefined : category,
                            }))}
                            className={[
                              "px-3 py-1.5 rounded-full text-xs transition-colors whitespace-nowrap",
                              filterState.category === category
                                ? "bg-accent text-white"
                                : "bg-surface-2 text-muted hover:text-foreground",
                            ].join(" ")}
                          >
                            {memoryCategoryLabel(category, t)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {pendingCount > 0 && (
                      <button
                        onClick={() => setFilterState((current) => ({
                          ...(!current.showPending ? {} : current),
                          showPending: !current.showPending,
                        }))}
                        className={[
                          "w-fit rounded-lg px-3 py-1.5 text-xs transition-colors",
                          filterState.showPending
                            ? "bg-amber-400/20 text-amber-400"
                            : "bg-surface-2 text-muted hover:text-foreground",
                        ].join(" ")}
                      >
                        {t("pending_review_count_one", { count: pendingCount, defaultValue: `${pendingCount} pending review ${pendingCount === 1 ? "memory" : "memories"}` })}
                      </button>
                    )}
                  </div>

                  {/* Memory list */}
                  {memories === undefined ? (
                    <div className="flex justify-center py-8"><LoadingSpinner /></div>
                  ) : filterState.showPending ? (
                    /* Show only pending memories when pending filter is active */
                    filteredPendingMemories.length === 0 ? (
                      <div className="text-center py-12 text-muted text-sm">
                        {t("no_memories_match_filters")}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="px-1 text-xs font-medium uppercase tracking-wide text-amber-400">
                            {t("memory_pending_review")}
                          </p>
                          <div className="overflow-hidden rounded-2xl bg-surface-2 divide-y divide-border/50">
                            {filteredPendingMemories.map((memory) => (
                              <MemoryItemRow
                                key={memory._id}
                                memory={memory}
                                onDelete={(id) => setDeleteTarget(id)}
                                onPin={(id) => void togglePin({ memoryId: id })}
                                onApprove={(id) => void approve({ memoryId: id })}
                                onReject={(id) => void reject({ memoryId: id })}
                                onEdit={setEditingMemory}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  ) : displayedMemories.length === 0 && filteredPendingMemories.length === 0 ? (
                    <div className="text-center py-12 text-muted text-sm">
                      {t("no_memories_match_filters")}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Pending section — always shown when there are pending memories */}
                      {filteredPendingMemories.length > 0 && (
                        <div className="space-y-2">
                          <p className="px-1 text-xs font-medium uppercase tracking-wide text-amber-400">
                            {t("memory_pending_review")}
                          </p>
                          <div className="overflow-hidden rounded-2xl bg-surface-2 divide-y divide-border/50">
                            {filteredPendingMemories.map((memory) => (
                              <MemoryItemRow
                                key={memory._id}
                                memory={memory}
                                onDelete={(id) => setDeleteTarget(id)}
                                onPin={(id) => void togglePin({ memoryId: id })}
                                onApprove={(id) => void approve({ memoryId: id })}
                                onReject={(id) => void reject({ memoryId: id })}
                                onEdit={setEditingMemory}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Saved memory sections */}
                      {[
                        { key: "alwaysOn", title: t("memory_retrieval_always_on"), memories: alwaysOnMemories },
                        { key: "contextual", title: t("memory_retrieval_contextual"), memories: contextualMemories },
                        { key: "ignored", title: t("memory_retrieval_ignored"), memories: ignoredMemories },
                      ].map((section) => (
                        section.memories.length > 0 && (
                          <div key={section.key} className="space-y-2">
                            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
                              {section.title}
                            </p>
                            <div className="overflow-hidden rounded-2xl bg-surface-2 divide-y divide-border/50">
                              {section.memories.map((memory) => (
                              <MemoryItemRow
                                key={memory._id}
                                memory={memory}
                                onDelete={(id) => setDeleteTarget(id)}
                                onPin={(id) => void togglePin({ memoryId: id })}
                                onApprove={(id) => void approve({ memoryId: id })}
                                onReject={(id) => void reject({ memoryId: id })}
                                onEdit={setEditingMemory}
                              />
                            ))}
                          </div>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Section 6: Clear All Memories */}
              <div className="rounded-2xl bg-surface-2 overflow-hidden">
                <button
                  onClick={() => setDeleteAll(true)}
                  disabled={savedCount === 0 && pendingCount === 0}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left disabled:opacity-40"
                >
                  <Trash2 size={16} className="text-red-400 flex-shrink-0" />
                  <span className="text-sm text-red-400">{t("memory_clear_all")}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add Memory dialog */}
      {showAddDialog && <MemoryEditorDialog onClose={() => setShowAddDialog(false)} />}
      {editingMemory && <MemoryEditorDialog memory={editingMemory} onClose={() => setEditingMemory(null)} />}
      {importCandidates.length > 0 && (
        <ImportReviewDialog
          candidates={importCandidates}
          onClose={() => setImportCandidates([])}
          onSave={handleCommitImportedMemories}
        />
      )}

      {/* Model Picker modal */}
      {showModelPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowModelPicker(false)} />
          <div className="relative w-full max-w-lg h-[80vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl bg-background border border-border/50">
            <ModelPicker
              selectedModelId={memoryExtractionModelId}
              onSelect={(modelId) => {
                const value = modelId === DEFAULT_MEMORY_MODEL ? null : modelId;
                updatePreferenceImmediate({ memoryExtractionModelId: value });
              }}
              onClose={() => setShowModelPicker(false)}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) void removeMem({ memoryId: deleteTarget }); setDeleteTarget(null); }}
        title={t("delete_memory_title")}
        description={t("delete_memory_description")}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
      />
      <ConfirmDialog
        isOpen={deleteAll}
        onClose={() => setDeleteAll(false)}
        onConfirm={() => { void deleteAllMem({}); setDeleteAll(false); }}
        title={t("memory_clear_all_title")}
        description={t("memory_clear_all_message")}
        confirmLabel={t("memory_delete_all")}
        confirmVariant="destructive"
      />
      {isImporting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="rounded-2xl bg-surface-1 px-6 py-5 shadow-xl flex items-center gap-3">
            <LoadingSpinner />
            <span className="text-sm">Uploading and extracting memories...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemoryPage() {
  return (
    <ProGateWrapper feature="Memory">
      <MemoryPageContent />
    </ProGateWrapper>
  );
}
