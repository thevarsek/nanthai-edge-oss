import { useCallback, useRef, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";

export function useAttachments(onCreateUploadUrl: () => Promise<string>) {
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      setIsUploading(true);
      try {
        for (const file of files) {
          const uploadUrl = await onCreateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!res.ok) continue;
          const { storageId } = (await res.json()) as { storageId: string };
          setAttachments((prev) => [
            ...prev,
            {
              storageId: storageId as Id<"_storage">,
              name: file.name,
              type: file.type.startsWith("image") ? "image" : "file",
              mimeType: file.type,
              sizeBytes: file.size,
            },
          ]);
        }
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onCreateUploadUrl],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    setAttachments,
    isUploading,
    fileInputRef,
    imageInputRef,
    cameraInputRef,
    handleFileSelect,
    removeAttachment,
    clear,
  };
}
