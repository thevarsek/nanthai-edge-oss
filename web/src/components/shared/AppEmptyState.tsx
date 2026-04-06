// AppEmptyState.tsx
// Right-pane empty state when no chat is selected.
// Mirrors the iOS empty state: "N" monogram in rounded square + "NanthAI : Edge" + subtitle.

import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SquarePen } from "lucide-react";
import { BrandWordmark } from "@/components/shared/BrandWordmark";
import { useToast } from "@/components/shared/Toast.context";
import { useSharedData } from "@/hooks/useSharedData";
import { buildDefaultParticipants, launchChat, type PersonaLike } from "@/lib/chatLaunch";
import { Defaults } from "@/lib/constants";

export function AppEmptyState() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const createChat = useMutation(api.chat.mutations.createChat);
  const { prefs, personas } = useSharedData();

  const handleNewChat = useCallback(async () => {
    try {
      const participants = buildDefaultParticipants({
        prefs: prefs as { defaultModelId?: string; defaultPersonaId?: string } | undefined,
        personas: (personas ?? []) as PersonaLike[],
        fallbackModelId: Defaults.model,
      });
      const chatId = await launchChat({ createChat, participants });
      navigate(`/app/chat/${chatId}`);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : t("something_went_wrong"),
        variant: "error",
      });
    }
  }, [createChat, navigate, personas, prefs, t, toast]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full select-none">
      <BrandWordmark size="lg" className="mb-2" />

      {/* Subtitle */}
      <p className="text-sm text-foreground/40 mb-8">
        {t("select_a_chat")}
      </p>

      {/* New chat button */}
      <button
        onClick={() => void handleNewChat()}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/12 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
      >
        <SquarePen size={16} />
        {t("new_chat")}
      </button>
    </div>
  );
}
