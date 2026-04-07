import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { type Id } from "@convex/_generated/dataModel";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSharedData } from "@/hooks/useSharedData";
import { useProGate } from "@/hooks/useProGate.hook";
import { PersonaCard } from "@/components/personas/PersonaCard";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { useToast } from "@/components/shared/Toast.context";
import { convexErrorMessage } from "@/lib/convexErrors";
import { buildPersonaParticipants, launchChat } from "@/lib/chatLaunch";
import { Defaults } from "@/lib/constants";

// ── Types ──────────────────────────────────────────────────────────────────

type ViewMode = "grid" | "list";

// ── Upgrade prompt ─────────────────────────────────────────────────────────

function UpgradePrompt({ onUpgrade }: { onUpgrade: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div>
        <h2 className="font-semibold text-base">{t("personas_pro_feature_title")}</h2>
        <p className="text-sm text-muted mt-1 max-w-xs">
          {t("personas_pro_feature_desc")}
        </p>
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
      >
        {t("upgrade_to_pro")}
      </button>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function PersonasPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { personas } = useSharedData();
  const { isPro } = useProGate();
  const { toast } = useToast();
  const removePersona = useMutation(api.personas.mutations.remove);
  const createChat = useMutation(api.chat.mutations.createChat);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [deleteId, setDeleteId] = useState<Id<"personas"> | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  // ── Filter ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!personas) return [];
    const q = search.toLowerCase();
    if (!q) return personas;
    return personas.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.personaDescription?.toLowerCase().includes(q),
    );
  }, [personas, search]);

  // ── Actions ────────────────────────────────────────────────────────────

  const handleNewChat = useCallback(
    async (id: Id<"personas">) => {
      const persona = personas?.find((candidate) => candidate._id === id);
      if (!persona) return;
      try {
        const chatId = await launchChat({
          createChat,
          participants: buildPersonaParticipants(persona, Defaults.model),
        });
        navigate(`/app/chat/${chatId}`);
      } catch (error) {
        toast({
          message: convexErrorMessage(error, t("something_went_wrong")),
          variant: "error",
        });
      }
    },
    [createChat, navigate, personas, t, toast],
  );

  const handleEdit = useCallback(
    (id: Id<"personas">) => {
      navigate(`/app/personas/${id}/edit`);
    },
    [navigate],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteId) return;
    try {
      await removePersona({ personaId: deleteId });
    } catch (e) {
      toast({
        message: convexErrorMessage(e, t("persona_delete_failed")),
        variant: "error",
      });
    } finally {
      setDeleteId(null);
    }
  }, [deleteId, removePersona, toast, t]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (personas === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-border/50 flex-shrink-0">
          <button
            onClick={() => navigate("/app/settings")}
            className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-lg font-semibold flex-1">{t("personas")}</h1>
        </div>
        <UpgradePrompt onUpgrade={() => setShowPaywall(true)} />
        {showPaywall && (
          <PaywallModal
            feature="AI Personas"
            onClose={() => setShowPaywall(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/50 flex-shrink-0">
        <button
          onClick={() => navigate("/app/settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{t("personas")}</h1>
        <button
          onClick={() => navigate("/app/personas/new")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("new_persona")}
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 flex-shrink-0">
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_personas")}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-2 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted/60"
          />
        </div>
        <div className="flex items-center rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setView("grid")}
            className={`p-1.5 transition-colors ${view === "grid" ? "bg-surface-3 text-primary" : "text-muted hover:text-primary"}`}
            title={t("grid_view")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => setView("list")}
            className={`p-1.5 transition-colors ${view === "list" ? "bg-surface-3 text-primary" : "text-muted hover:text-primary"}`}
            title={t("list_view")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          search ? (
            <EmptyState
              icon={
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
              title={t("no_personas_found")}
              description={t("no_personas_match_desc", { search })}
            />
          ) : (
            <EmptyState
              icon={
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              }
              title={t("no_personas_yet")}
              description={t("no_personas_yet_desc")}
              action={
                <button
                  onClick={() => navigate("/app/personas/new")}
                  className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
                >
                  {t("create_persona")}
                </button>
              }
            />
          )
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((p) => (
              <PersonaCard
                key={p._id}
                persona={p}
                view="grid"
                onEdit={handleEdit}
                onDelete={setDeleteId}
                onNewChat={handleNewChat}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((p) => (
              <PersonaCard
                key={p._id}
                persona={p}
                view="list"
                onEdit={handleEdit}
                onDelete={setDeleteId}
                onNewChat={handleNewChat}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteId !== null}
        title={t("delete_persona_title")}
        description={t("delete_persona_description")}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
}
