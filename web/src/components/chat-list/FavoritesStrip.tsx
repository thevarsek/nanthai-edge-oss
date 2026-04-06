import { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSharedData } from "@/hooks/useSharedData";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { useToast } from "@/components/shared/Toast.context";
import { cn } from "@/lib/utils";
import { buildFavoriteParticipants, launchChat } from "@/lib/chatLaunch";

// ─── Avatar — circular, matching iOS FavoritesStripView ─────────────────────

interface FavoriteAvatarProps {
  personaId?: string;
  modelIds: string[];
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  personaName?: string;
}

function FavoriteAvatar({ personaId, modelIds, personaEmoji, personaAvatarImageUrl, personaName }: FavoriteAvatarProps) {
  // Persona favorite — use 4-tier fallback
  if (personaAvatarImageUrl || personaEmoji || personaName) {
    return (
      <PersonaAvatar
        personaId={personaId}
        personaName={personaName}
        personaEmoji={personaEmoji}
        personaAvatarImageUrl={personaAvatarImageUrl}
        className="w-12 h-12"
        emojiClass="text-2xl"
        initialClass="text-base"
        iconSize={20}
      />
    );
  }
  // Single model — circular
  if (modelIds.length === 1) {
    return (
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden">
        <ProviderLogo modelId={modelIds[0]} size={36} />
      </div>
    );
  }
  // Multi-model group — overlapping circular logos in a circular container
  // iOS uses ZStack with manual offsets; we approximate with absolute positioning
  const count = Math.min(modelIds.length, 3);
  const miniSize = count >= 3 ? 22 : 26;

  // Offset patterns matching iOS's triangular/diagonal layout
  const offsets: { left: number; top: number }[] =
    count === 3
      ? [
          { left: 12, top: 0 },   // top center
          { left: 0, top: 16 },   // bottom left
          { left: 22, top: 16 },  // bottom right
        ]
      : [
          { left: 4, top: 4 },    // top-left
          { left: 18, top: 18 },  // bottom-right
        ];

  return (
    <div className="w-12 h-12 rounded-full relative overflow-hidden bg-muted">
      {modelIds.slice(0, count).map((modelId, idx) => (
        <div
          key={modelId}
          className="absolute"
          style={{ left: offsets[idx].left, top: offsets[idx].top, zIndex: count - idx }}
        >
          <ProviderLogo modelId={modelId} size={miniSize} />
        </div>
      ))}
    </div>
  );
}

/**
 * Horizontal favorites strip shown at the top of the chat list.
 * Each cell is a quick-launch shortcut: tap to create a new chat
 * with the favorite's participant(s) pre-selected.
 *
 * Desktop: hover arrow buttons for non-trackpad users.
 * Mobile: natural touch scroll.
 */
export function FavoritesStrip() {
  const { t } = useTranslation();
  const { favorites } = useSharedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const createChat = useMutation(api.chat.mutations.createChat);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const sorted = (favorites ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  // Track overflow state for arrow button visibility
  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sorted.length]);

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: dir === "left" ? -200 : 200,
      behavior: "smooth",
    });
  };

  if (sorted.length === 0) return null;

  async function handleTap(fav: (typeof sorted)[0]) {
    try {
      const participants = buildFavoriteParticipants(fav);
      const chatId = await launchChat({ createChat, participants });
      navigate(`/app/chat/${chatId}`);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : t("something_went_wrong"),
        variant: "error",
      });
    }
  }

  return (
    <div className="px-3 pt-2 pb-1 group/fav relative">
      {/* Left arrow — shown on hover when scrollable */}
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface-2/90 border border-border/50 flex items-center justify-center opacity-0 group-hover/fav:opacity-100 transition-opacity shadow-sm hover:bg-surface-3"
          aria-label={t("scroll_left")}
        >
          <ChevronLeft size={14} />
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto pb-1"
      >
        {sorted.map((fav) => (
          <button
            key={fav._id as string}
            onClick={() => handleTap(fav)}
            className={cn(
              "flex flex-col items-center gap-1.5 flex-shrink-0 w-16",
              "hover:opacity-80 active:scale-95 transition-all",
            )}
          >
              <FavoriteAvatar
                personaId={fav.personaId as string | undefined}
                modelIds={fav.modelIds}
                personaEmoji={fav.personaEmoji ?? undefined}
                personaAvatarImageUrl={fav.personaAvatarImageUrl ?? undefined}
              personaName={fav.personaName ?? undefined}
            />
            <span className="text-[11px] text-foreground/60 truncate w-full text-center leading-tight">
              {fav.name}
            </span>
          </button>
        ))}
      </div>

      {/* Right arrow — shown on hover when scrollable */}
      {canScrollRight && (
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface-2/90 border border-border/50 flex items-center justify-center opacity-0 group-hover/fav:opacity-100 transition-opacity shadow-sm hover:bg-surface-3"
          aria-label={t("scroll_right")}
        >
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
