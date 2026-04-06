// ManageFavoritesPage.tsx
// Manage quick-launch favorites: reorder, create, edit, delete.
// Matches iOS ManageFavoritesView: reorder mode, multi-model groups,
// persona avatars, provider logos.

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronLeft, SquarePen, Trash2, Plus, Star, GripVertical, ChevronRight } from "lucide-react";
import { useSharedData } from "@/hooks/useSharedData";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { FavoriteEditorModal, type FavoriteDoc } from "./ManageFavoritesHelpers";

// ─── Multi-model avatar (iOS-style stacked logos) ───────────────────────────

function FavoriteAvatar({ favorite }: { favorite: FavoriteDoc }) {
  if (favorite.personaEmoji) {
    return (
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg flex-shrink-0">
        {favorite.personaEmoji}
      </div>
    );
  }
  if (favorite.modelIds.length === 1) {
    return (
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
        <ProviderLogo modelId={favorite.modelIds[0]} size={28} />
      </div>
    );
  }
  // Multi-model group: overlapping provider logos (iOS ZStack style)
  return (
    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden relative">
      {favorite.modelIds.slice(0, 3).map((modelId, idx) => (
        <div
          key={modelId}
          className="absolute"
          style={{
            left: idx * 8 + 2,
            top: idx * 2 + 4,
            zIndex: 3 - idx,
          }}
        >
          <ProviderLogo modelId={modelId} size={favorite.modelIds.length >= 3 ? 16 : 20} />
        </div>
      ))}
    </div>
  );
}

// ─── Favorite row ────────────────────────────────────────────────────────────

function FavoriteRow({
  favorite,
  isReordering,
  onEdit,
  onDelete,
}: {
  favorite: FavoriteDoc;
  isReordering: boolean;
  onEdit: (f: FavoriteDoc) => void;
  onDelete: (id: Id<"favorites">) => void;
}) {
  const { t } = useTranslation();
  const subtitle =
    favorite.personaName
      ? `${favorite.personaName} · ${favorite.modelIds[0]?.split("/").pop() ?? ""}`
      : favorite.modelIds.length > 1
        ? `${favorite.modelIds.length} models · ${favorite.modelIds.map((id) => id.split("/").pop()).join(", ")}`
        : favorite.modelIds[0]?.split("/").pop() ?? "";

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* Drag handle in reorder mode */}
      {isReordering && (
        <GripVertical size={16} className="text-foreground/30 cursor-grab flex-shrink-0" />
      )}

      <FavoriteAvatar favorite={favorite} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{favorite.name}</p>
        {subtitle && <p className="text-xs text-foreground/50 truncate">{subtitle}</p>}
      </div>

      {/* Actions (hidden in reorder mode) */}
      {!isReordering ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onEdit(favorite)}
            className="p-1.5 rounded-lg text-foreground/50 hover:text-foreground transition-colors"
            title={t("edit")}
          >
            <SquarePen size={14} />
          </button>
          <button
            onClick={() => onDelete(favorite._id)}
            className="p-1.5 rounded-lg text-foreground/50 hover:text-red-400 transition-colors"
            title={t("delete")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <ChevronRight size={14} className="text-foreground/30 flex-shrink-0" />
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function ManageFavoritesPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { favorites } = useSharedData();

  const deleteFavorite = useMutation(api.favorites.mutations.deleteFavorite);
  const reorderFavorites = useMutation(api.favorites.mutations.reorderFavorites);

  const [editing, setEditing] = useState<FavoriteDoc | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<Id<"favorites"> | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [localOrder, setLocalOrder] = useState<FavoriteDoc[] | null>(null);

  const sortedFavorites = (favorites ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder) as FavoriteDoc[];

  const displayList = localOrder ?? sortedFavorites;

  const startReorder = useCallback(() => {
    setIsReordering(true);
    setLocalOrder([...sortedFavorites]);
  }, [sortedFavorites]);

  const endReorder = useCallback(async () => {
    if (localOrder) {
      await reorderFavorites({
        orderedIds: localOrder.map((f) => f._id),
      });
    }
    setIsReordering(false);
    setLocalOrder(null);
  }, [localOrder, reorderFavorites]);

  const moveItem = useCallback((fromIndex: number, direction: "up" | "down") => {
    setLocalOrder((prev) => {
      if (!prev) return prev;
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      return next;
    });
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button
          onClick={() => navigate("/app/settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{t("favorites")}</h1>
        <div className="flex items-center gap-2">
          {sortedFavorites.length > 1 && (
            <button
              onClick={isReordering ? () => void endReorder() : startReorder}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              {isReordering ? t("done") : t("reorder")}
            </button>
          )}
          {!isReordering && (
            <button
              onClick={() => setEditing("new")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={14} strokeWidth={2.5} />
              {t("add_favorite")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {favorites === undefined ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : displayList.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                <Star size={28} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("no_favorites")}</p>
                <p className="text-xs text-foreground/50 mt-1 max-w-xs mx-auto">
                  {t("add_favorite_description")}
                </p>
              </div>
              <button
                onClick={() => setEditing("new")}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {t("add_favorite")}
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                {displayList.map((f, idx) => (
                  <div key={f._id} className="flex items-center">
                    {isReordering && (
                      <div className="flex flex-col pl-2">
                        <button
                          onClick={() => moveItem(idx, "up")}
                          disabled={idx === 0}
                          className="p-0.5 text-foreground/30 hover:text-foreground disabled:opacity-20 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 8 6 4 10 8" /></svg>
                        </button>
                        <button
                          onClick={() => moveItem(idx, "down")}
                          disabled={idx === displayList.length - 1}
                          className="p-0.5 text-foreground/30 hover:text-foreground disabled:opacity-20 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 4 6 8 10 4" /></svg>
                        </button>
                      </div>
                    )}
                    <div className="flex-1">
                      <FavoriteRow
                        favorite={f}
                        isReordering={isReordering}
                        onEdit={(fav) => setEditing(fav)}
                        onDelete={(id) => setDeleteTarget(id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted px-1">
                {t("favorites_footer")}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Editor modal */}
      {editing !== null && (
        <FavoriteEditorModal editing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) void deleteFavorite({ favoriteId: deleteTarget }); setDeleteTarget(null); }}
        title={t("delete_favorite_title")}
        description={t("delete_favorite_description")}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
      />
    </div>
  );
}
