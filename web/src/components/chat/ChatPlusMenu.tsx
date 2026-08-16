import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Bot,
  Camera,
  ClipboardPaste,
  FileText,
  Image,
  MessageCircleQuestion,
  MessagesSquare,
  PuzzleIcon,
  Server,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";

export type PlusMenuItem =
  | "conversationMode"
  | "parameters"
  | "integrations"
  | "skills"
  | "knowledgeBase"
  | "file"
  | "image"
  | "camera"
  | "pasteImage"
  | "participants"
  | "advisors"
  | "subagents"
  | "remoteMcpContent";

interface MenuItemDef {
  id: PlusMenuItem;
  label: string;
  icon: ReactNode;
  badge?: number;
  disabled?: boolean;
  requiresPro?: boolean;
}

interface MenuSection {
  label: string;
  items: MenuItemDef[];
}

interface Props {
  onSelect: (item: PlusMenuItem) => void;
  onClose: () => void;
  badges?: Partial<Record<PlusMenuItem, number>>;
  isPro?: boolean;
  hasConnectedIntegrations?: boolean;
  participantCount?: number;
  allParticipantsSupportTools?: boolean;
  clipboardHasImage?: boolean;
  supportsVision?: boolean;
  supportsFileInput?: boolean;
  supportsAudioInput?: boolean;
  hasRemoteMcpContent?: boolean;
}

export function ChatPlusMenu({
  onSelect,
  onClose,
  badges = {},
  isPro = false,
  hasConnectedIntegrations = false,
  participantCount = 1,
  allParticipantsSupportTools = true,
  clipboardHasImage = false,
  supportsVision = true,
  supportsFileInput = true,
  supportsAudioInput = false,
  hasRemoteMcpContent = false,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const conversationItems: MenuItemDef[] = [
    ...(participantCount >= 2
      ? [{
          id: "conversationMode" as const,
          label: t("conversation_mode"),
          icon: <MessagesSquare size={16} />,
        }]
      : []),
    {
      id: "participants",
      label: t("participants"),
      icon: <Users size={16} />,
    },
    {
      id: "advisors",
      label: t("advisors"),
      icon: <MessageCircleQuestion size={16} />,
      badge: badges.advisors,
      requiresPro: true,
    },
    ...(isPro
      ? [{
          id: "subagents" as const,
          label: badges.subagents ? t("subagents_on") : t("subagents"),
          icon: <Bot size={16} />,
          badge: badges.subagents,
          disabled: !allParticipantsSupportTools,
        }]
      : []),
  ];

  const contextItems: MenuItemDef[] = [
    ...(supportsVision
      ? [
          { id: "image" as const, label: t("photo_library"), icon: <Image size={16} /> },
          { id: "camera" as const, label: t("camera"), icon: <Camera size={16} /> },
          ...(clipboardHasImage
            ? [{ id: "pasteImage" as const, label: t("paste_image", "Paste Image"), icon: <ClipboardPaste size={16} /> }]
            : []),
        ]
      : []),
    ...(supportsFileInput || supportsAudioInput
      ? [{ id: "file" as const, label: t("file"), icon: <FileText size={16} /> }]
      : []),
    ...(isPro
      ? [{
          id: "knowledgeBase" as const,
          label: t("knowledge_base"),
          icon: <BookOpen size={16} />,
          badge: badges.knowledgeBase,
        }]
      : []),
    ...(isPro && hasRemoteMcpContent
      ? [{ id: "remoteMcpContent" as const, label: t("remote_mcp_context"), icon: <Server size={16} /> }]
      : []),
  ];

  const capabilityItems: MenuItemDef[] = [
    {
      id: "parameters",
      label: badges.parameters ? t("chat_parameters_on") : t("chat_parameters"),
      icon: <SlidersHorizontal size={16} />,
      badge: badges.parameters,
    },
    ...(hasConnectedIntegrations
      ? [{
          id: "integrations" as const,
          label: t("integrations"),
          icon: <PuzzleIcon size={16} />,
          badge: badges.integrations,
          disabled: !allParticipantsSupportTools,
        }]
      : []),
    ...(isPro
      ? [{
          id: "skills" as const,
          label: t("skills"),
          icon: <Sparkles size={16} />,
          badge: badges.skills,
          disabled: !allParticipantsSupportTools,
        }]
      : []),
  ];

  const sections: MenuSection[] = [
    { label: t("conversation"), items: conversationItems },
    { label: t("add_context"), items: contextItems },
    { label: t("capabilities"), items: capabilityItems },
  ].filter((section) => section.items.length > 0);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-50 mb-2 max-h-[min(32rem,70vh)] w-64 overflow-y-auto rounded-xl border border-border/50 bg-surface-1 py-1 shadow-xl"
    >
      {sections.map((section, sectionIndex) => (
        <section
          key={section.label}
          aria-label={section.label}
          className={sectionIndex > 0 ? "border-t border-border/30 pt-1" : undefined}
        >
          <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {section.label}
          </p>
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!item.disabled) {
                  onSelect(item.id);
                  onClose();
                }
              }}
              disabled={item.disabled}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${item.disabled ? "cursor-not-allowed opacity-40" : "hover:bg-surface-2"}`}
            >
              <span className="shrink-0 text-primary">{item.icon}</span>
              <span className="flex-1 text-sm">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {item.badge}
                </span>
              )}
              {item.requiresPro && !isPro && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                  PRO
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
