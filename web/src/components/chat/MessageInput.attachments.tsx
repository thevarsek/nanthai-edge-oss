// components/chat/MessageInput.attachments.tsx — File upload logic + attachment preview pills.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
          {isVideoMode && att.type === "image" && (
            <button
              onClick={() => setOpenDropdown(openDropdown === i ? null : i)}
              className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium hover:bg-accent/20 transition-colors"
            >
              {att.videoRole ? t(ROLE_LABEL_KEYS[att.videoRole]) : t("image_role_unset", "Role")}
              <ChevronDown size={10} />
            </button>
          )}
          {openDropdown === i && onChangeRole && (
            <RoleDropdown
              currentRole={att.videoRole}
              onPick={(role) => { onChangeRole(i, role); setOpenDropdown(null); }}
              onClose={() => setOpenDropdown(null)}
              labelFor={(role) => t(ROLE_LABEL_KEYS[role])}
            />
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

// MARK: - RoleDropdown (auto-flips above when near viewport bottom)

function RoleDropdown({
  currentRole,
  onPick,
  onClose,
  labelFor,
}: {
  currentRole: VideoRole | undefined;
  onPick: (role: VideoRole) => void;
  onClose: () => void;
  labelFor: (role: VideoRole) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // "below" by default; flip to "above" if there isn't enough space below.
  const [placement, setPlacement] = useState<"below" | "above">("below");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const estHeight = el.offsetHeight || 120; // fallback before first paint
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < estHeight + 12 && spaceAbove > spaceBelow) {
      setPlacement("above");
    } else {
      setPlacement("below");
    }
  }, []);

  // Close on outside click
  const handleBackdrop = useCallback(() => onClose(), [onClose]);

  return (
    <>
      {/* Invisible backdrop to catch outside clicks */}
      <div
        className="fixed inset-0 z-40"
        onClick={handleBackdrop}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={`absolute left-0 z-50 bg-surface-1 border border-border rounded-lg shadow-lg py-1 min-w-[8rem] ${
          placement === "above" ? "bottom-full mb-1" : "top-full mt-1"
        }`}
        role="menu"
      >
        {VIDEO_ROLES.map((role) => (
          <button
            key={role}
            onClick={() => onPick(role)}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors ${currentRole === role ? "text-accent font-medium" : "text-foreground"}`}
            role="menuitem"
          >
            {labelFor(role)}
          </button>
        ))}
      </div>
    </>
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
