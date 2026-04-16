import { useCallback, useRef, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { AttachmentPreview, VideoRole } from "@/components/chat/MessageInput.attachments.types";
import { attachmentTypeForMime } from "@/components/chat/MessageInput.attachments.utils";

/** Assigns smart default videoRoles to image attachments: 1st=first_frame, 2nd=last_frame, 3rd+=reference */
function assignDefaultVideoRoles(attachments: AttachmentPreview[]): AttachmentPreview[] {
  let imageIndex = 0;
  return attachments.map((att) => {
    if (att.type !== "image") return att;
    const role: VideoRole = imageIndex === 0 ? "first_frame" : imageIndex === 1 ? "last_frame" : "reference";
    imageIndex++;
    return { ...att, videoRole: att.videoRole ?? role };
  });
}

export function useAttachments(
  onCreateUploadUrl: () => Promise<string>,
  isVideoMode = false,
  supportsFrameImages = false,
) {
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
              type: attachmentTypeForMime(file.type),
              mimeType: file.type,
              sizeBytes: file.size,
            },
          ]);
        }
        // Assign default video roles to all images if we're already in video mode
        // and the model supports frame images (image-to-video models only).
        if (isVideoMode && supportsFrameImages) {
          setAttachments((prev) => assignDefaultVideoRoles(prev));
        }
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onCreateUploadUrl, isVideoMode, supportsFrameImages],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const changeAttachmentRole = useCallback((index: number, role: VideoRole) => {
    setAttachments((prev) => prev.map((att, i) => i === index ? { ...att, videoRole: role } : att));
  }, []);

  /** Re-assign default video roles to all image attachments (call when entering video mode). */
  const applyVideoRoles = useCallback(() => {
    setAttachments((prev) => assignDefaultVideoRoles(prev));
  }, []);

  /** Handle pasted files (e.g. images from clipboard via Ctrl+V / Cmd+V). */
  const handlePasteFiles = useCallback(
    async (files: File[]) => {
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
              name: file.name || `pasted-image.${file.type.split("/")[1] || "png"}`,
              type: attachmentTypeForMime(file.type),
              mimeType: file.type,
              sizeBytes: file.size,
            },
          ]);
        }
        if (isVideoMode && supportsFrameImages) {
          setAttachments((prev) => assignDefaultVideoRoles(prev));
        }
      } finally {
        setIsUploading(false);
      }
    },
    [onCreateUploadUrl, isVideoMode, supportsFrameImages],
  );

  const clear = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    setAttachments,
    isUploading,
    fileInputRef,
    imageInputRef,
    cameraInputRef,
    handleFileSelect,
    handlePasteFiles,
    removeAttachment,
    changeAttachmentRole,
    applyVideoRoles,
    clear,
  };
}
