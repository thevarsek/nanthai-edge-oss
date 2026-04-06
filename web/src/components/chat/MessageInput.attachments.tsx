// components/chat/MessageInput.attachments.tsx — File upload logic + attachment preview pills.

import { X } from "lucide-react";
import type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";

/** Renders the attachment pill previews above the input row. */
export function AttachmentPreviews({ attachments, onRemove }: {
  attachments: AttachmentPreview[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((att, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-2/50 text-xs text-foreground"
        >
          <span>{att.type === "image" ? "\u{1F5BC}" : "\u{1F4CE}"}</span>
          <span className="max-w-32 truncate">{att.name}</span>
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
