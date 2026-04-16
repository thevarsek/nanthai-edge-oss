// components/chat/MessageInput.attachments.tsx — File upload logic + attachment preview pills.

import { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AttachmentPreview, VideoRole } from "@/components/chat/MessageInput.attachments.types";

const VIDEO_ROLES: VideoRole[] = ["first_frame", "last_frame", "reference"];
const ROLE_LABEL_KEYS: Record<VideoRole, string> = {
  first_frame: "image_role_first_frame",
  last_frame: "image_role_last_frame",
  reference: "image_role_reference",
};

/** Renders the attachment pill previews above the input row. */
export function AttachmentPreviews({ attachments, onRemove, isVideoMode, onChangeRole }: {
  attachments: AttachmentPreview[];
  onRemove: (index: number) => void;
  isVideoMode?: boolean;
  onChangeRole?: (index: number, role: VideoRole) => void;
}) {
  const { t } = useTranslation();
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((att, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-2/50 text-xs text-foreground relative"
        >
          <span>{att.type === "image" ? "\u{1F5BC}" : "\u{1F4CE}"}</span>
          <span className="max-w-32 truncate">{att.name}</span>
          {isVideoMode && att.type === "image" && att.videoRole && (
            <button
              onClick={() => setOpenDropdown(openDropdown === i ? null : i)}
              className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium hover:bg-accent/20 transition-colors"
            >
              {t(ROLE_LABEL_KEYS[att.videoRole])}
              <ChevronDown size={10} />
            </button>
          )}
          {openDropdown === i && onChangeRole && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-surface-1 border border-border rounded-lg shadow-lg py-1 min-w-[8rem]">
              {VIDEO_ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => { onChangeRole(i, role); setOpenDropdown(null); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors ${att.videoRole === role ? "text-accent font-medium" : "text-foreground"}`}
                >
                  {t(ROLE_LABEL_KEYS[role])}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="text-muted hover:text-foreground transition-colors ml-0.5"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Renders the hidden <input type="file"> elements. */
export function HiddenFileInputs({ fileInputRef, imageInputRef, cameraInputRef, onSelect }: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx" onChange={onSelect} className="hidden" />
      <input ref={imageInputRef} type="file" multiple accept="image/*" onChange={onSelect} className="hidden" />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={onSelect} className="hidden" />
    </>
  );
}
