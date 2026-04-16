// components/chat/ChatPlusMenu.tsx
// Dropdown menu triggered by the + button in the message input.
// Mirrors iOS MessageInput.swift plus-menu order exactly.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  SlidersHorizontal,
  PuzzleIcon,
  Sparkles,
  BookOpen,
  FileText,
  Image,
  Camera,
  Users,
  Bot,
  Zap,
  ClipboardPaste,
} from "lucide-react";

// ─── Menu items ─────────────────────────────────────────────────────────────

export type PlusMenuItem =
  | "parameters"
  | "integrations"
  | "skills"
  | "knowledgeBase"
  | "file"
  | "image"
  | "camera"
  | "pasteImage"
  | "participants"
  | "subagents"
  | "autonomous";

interface MenuItemDef {
  id: PlusMenuItem;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  requiresPro?: boolean;
  dividerBefore?: boolean;
  disabled?: boolean;
}

interface Props {
  onSelect: (item: PlusMenuItem) => void;
  onClose: () => void;
  badges?: Partial<Record<PlusMenuItem, number>>;
  isPro?: boolean;
  hasConnectedIntegrations?: boolean;
  participantCount?: number;
  hasMessages?: boolean;
  allParticipantsSupportTools?: boolean;
  clipboardHasImage?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatPlusMenu({
  onSelect,
  onClose,
  badges = {},
  isPro = false,
  hasConnectedIntegrations = false,
  participantCount = 1,
  hasMessages = false,
  allParticipantsSupportTools = true,
  clipboardHasImage = false,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // iOS order: Participants, Parameters, Autonomous, divider,
  // Photo/Camera/File/KB, divider, Subagents, Integrations, Skills
  const items: MenuItemDef[] = [
    {
      id: "participants",
      label: t("participants"),
      icon: <Users size={16} />,
    },
    {
      id: "parameters",
      label: badges.parameters ? t("chat_parameters_on") : t("chat_parameters"),
      icon: <SlidersHorizontal size={16} />,
      badge: badges.parameters,
    },
    // Autonomous: needs 2+ participants and messages, Pro-gated
    ...(isPro && participantCount >= 2 && hasMessages
      ? [{
          id: "autonomous" as const,
          label: t("autonomous_discussion"),
          icon: <Zap size={16} />,
          requiresPro: true,
        }]
      : []),
    // ─── Divider: attachments section ───
    {
      id: "image" as const,
      label: t("photo_library"),
      icon: <Image size={16} />,
      dividerBefore: true,
    },
    {
      id: "camera" as const,
      label: t("camera"),
      icon: <Camera size={16} />,
    },
    ...(clipboardHasImage
      ? [{
          id: "pasteImage" as const,
          label: t("paste_image", "Paste Image"),
          icon: <ClipboardPaste size={16} />,
        }]
      : []),
    {
      id: "file" as const,
      label: t("file"),
      icon: <FileText size={16} />,
    },
    ...(isPro
      ? [{
          id: "knowledgeBase" as const,
          label: t("knowledge_base"),
          icon: <BookOpen size={16} />,
          badge: badges.knowledgeBase,
          requiresPro: true,
        }]
      : []),
    // ─── Divider: tools section ───
    ...(isPro && participantCount === 1
      ? [{
          id: "subagents" as const,
          label: badges.subagents ? t("subagents_on") : t("subagents"),
          icon: <Bot size={16} />,
          badge: badges.subagents,
          requiresPro: true,
          dividerBefore: true,
          disabled: !allParticipantsSupportTools,
        }]
      : []),
    ...(hasConnectedIntegrations
      ? [{
          id: "integrations" as const,
          label: t("integrations"),
          icon: <PuzzleIcon size={16} />,
          badge: badges.integrations,
          dividerBefore: !isPro || participantCount !== 1 ? true : false,
          disabled: !allParticipantsSupportTools,
        }]
      : []),
    ...(isPro
      ? [{
          id: "skills" as const,
          label: t("skills"),
          icon: <Sparkles size={16} />,
          badge: badges.skills,
          requiresPro: true,
          disabled: !allParticipantsSupportTools,
        }]
      : []),
  ];

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-56 bg-surface-1 border border-border/50 rounded-xl shadow-xl overflow-hidden z-50"
    >
      <div className="py-1">
        {items.map((item) => (
          <div key={item.id}>
            {item.dividerBefore && (
              <div className="mx-3 my-1 border-t border-border/30" />
            )}
            <button
              onClick={() => { if (!item.disabled) { onSelect(item.id); onClose(); } }}
              disabled={item.disabled}
              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${item.disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-2"}`}
            >
              <span className="text-primary flex-shrink-0">{item.icon}</span>
              <span className="flex-1 text-sm">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  {item.badge}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
