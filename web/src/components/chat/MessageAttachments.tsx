import { useState } from "react";
import { useQuery } from "convex/react";
import {
  Download,
  File,
  FileArchive,
  FileAudio2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Presentation,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";

type MessageAttachment = NonNullable<Message["attachments"]>[number];

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  messageId: Id<"messages">;
  isUser: boolean;
}

function formatSize(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(attachment: MessageAttachment): boolean {
  return attachment.type === "image" || attachment.mimeType?.startsWith("image/") === true;
}

function getAttachmentName(attachment: MessageAttachment): string {
  return attachment.name?.trim() || "attachment";
}

function renderFileIcon(mimeType?: string | null) {
  const normalized = mimeType?.toLowerCase() ?? "";
  if (normalized.startsWith("image/")) return <FileImage size={18} />;
  if (normalized.startsWith("audio/")) return <FileAudio2 size={18} />;
  if (normalized.startsWith("video/")) return <FileVideo2 size={18} />;
  if (
    normalized.includes("pdf") ||
    normalized.includes("text") ||
    normalized.includes("word") ||
    normalized.includes("document")
  ) {
    return <FileText size={18} />;
  }
  if (
    normalized.includes("sheet") ||
    normalized.includes("excel") ||
    normalized.includes("csv")
  ) {
    return <FileSpreadsheet size={18} />;
  }
  if (
    normalized.includes("presentation") ||
    normalized.includes("powerpoint")
  ) {
    return <Presentation size={18} />;
  }
  if (
    normalized.includes("zip") ||
    normalized.includes("compressed") ||
    normalized.includes("archive")
  ) {
    return <FileArchive size={18} />;
  }
  return <File size={18} />;
}

function useResolvedAttachmentUrl(attachment: MessageAttachment, messageId: Id<"messages">) {
  return useQuery(
    api.chat.queries.getAttachmentUrl,
    attachment.storageId && !attachment.url
      ? { storageId: attachment.storageId, messageId }
      : "skip",
  );
}

function AttachmentImage({
  attachment,
  messageId,
}: {
  attachment: MessageAttachment;
  messageId: Id<"messages">;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolvedUrl = useResolvedAttachmentUrl(attachment, messageId);
  const url = attachment.url ?? resolvedUrl ?? undefined;
  const name = getAttachmentName(attachment);

  if (!url) return null;

  return (
    <>
      <button
        onClick={() => setExpanded(true)}
        className="block overflow-hidden rounded-xl border border-border/20 bg-surface-2/40 transition-colors hover:border-border/40"
      >
        <img
          src={url}
          alt={name}
          className="max-h-80 max-w-[240px] object-contain"
          loading="lazy"
        />
      </button>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <img
            src={url}
            alt={name}
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}

function AttachmentFileCard({
  attachment,
  messageId,
  isUser,
}: {
  attachment: MessageAttachment;
  messageId: Id<"messages">;
  isUser: boolean;
}) {
  const resolvedUrl = useResolvedAttachmentUrl(attachment, messageId);
  const url = attachment.url ?? resolvedUrl ?? undefined;
  const name = getAttachmentName(attachment);
  const sizeLabel = formatSize(attachment.sizeBytes);
  const cardClass = isUser
    ? "bg-primary text-white border border-white/10"
    : "bg-surface-2/50 text-foreground border border-border/20";
  const iconClass = isUser
    ? "bg-white/12 text-white/88"
    : "bg-primary/12 text-primary";
  const subtitleClass = isUser ? "text-white/65" : "text-muted";
  const content = (
    <>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        {renderFileIcon(attachment.mimeType)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {sizeLabel && <p className={`text-xs ${subtitleClass}`}>{sizeLabel}</p>}
      </div>
      {url && <Download size={16} className={subtitleClass} />}
    </>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={name}
        className={`flex w-full max-w-[220px] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:brightness-110 ${cardClass}`}
      >
        {content}
      </a>
    );
  }

  return (
    <div className={`flex w-full max-w-[220px] items-center gap-3 rounded-xl px-3 py-2.5 ${cardClass}`}>
      {content}
    </div>
  );
}

export function MessageAttachments({
  attachments,
  messageId,
  isUser,
}: MessageAttachmentsProps) {
  if (attachments.length === 0) return null;

  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((attachment) => !isImageAttachment(attachment));

  return (
    <div className={`space-y-2 ${isUser ? "items-end" : "items-start"}`}>
      {images.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
          {images.map((attachment, index) => (
            <AttachmentImage
              key={`${messageId}-image-${attachment.storageId ?? attachment.url ?? index}`}
              attachment={attachment}
              messageId={messageId}
            />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
          {files.map((attachment, index) => (
            <AttachmentFileCard
              key={`${messageId}-file-${attachment.storageId ?? attachment.url ?? index}`}
              attachment={attachment}
              messageId={messageId}
              isUser={isUser}
            />
          ))}
        </div>
      )}
    </div>
  );
}
