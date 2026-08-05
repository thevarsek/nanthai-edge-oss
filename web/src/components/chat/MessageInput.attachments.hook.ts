import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { AttachmentPreview, VideoRole } from "@/components/chat/MessageInput.attachments.types";
import { attachmentTypeForMime } from "@/components/chat/MessageInput.attachments.utils";

export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export interface ChatUploadSession {
  uploadUrl: string;
  uploadSessionId: string;
}

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
  onCreateUploadUrl: () => Promise<string | ChatUploadSession>,
  isVideoMode = false,
  supportsFrameImages = false,
  supportsVision = true,
  supportsFileInput = true,
  supportsAudioInput = false,
  onBindUploadSession?: (uploadSessionId: string, storageId: string) => Promise<void>,
  onCleanupUploadSession?: (uploadSessionId: string, storageId?: string) => Promise<void>,
) {
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<AttachmentPreview[]>([]);
  const committedBytesRef = useRef(0);
  const inFlightBytesRef = useRef(0);

  useEffect(() => {
    attachmentsRef.current = attachments;
    if (inFlightBytesRef.current === 0) {
      committedBytesRef.current = attachments.reduce(
        (sum, attachment) => sum + (attachment.sizeBytes ?? 0),
        0,
      );
    }
  }, [attachments]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploadCount((count) => count + 1);
    setUploadError(null);
    let failedCount = 0;
    let rejectedCount = 0;
    try {
      for (const file of files) {
        const mimeType = file.type || "application/octet-stream";
        const isImage = mimeType.startsWith("image/");
        const isAudio = mimeType.startsWith("audio/");
        const isAllowed = isImage ? supportsVision : isAudio
          ? supportsFileInput || supportsAudioInput
          : supportsFileInput;
        if (
          !isAllowed ||
          committedBytesRef.current + inFlightBytesRef.current + file.size > MAX_TOTAL_ATTACHMENT_BYTES
        ) {
          rejectedCount += 1;
          continue;
        }
        inFlightBytesRef.current += file.size;
        let uploadSessionId: string | undefined;
        let uploadedStorageId: string | undefined;
        try {
          const created = await onCreateUploadUrl() as string | ChatUploadSession;
          const uploadUrl = typeof created === "string" ? created : created.uploadUrl;
          uploadSessionId = typeof created === "string" ? undefined : created.uploadSessionId;
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: file,
          });
          if (!res.ok) {
            if (uploadSessionId && onCleanupUploadSession) {
              await onCleanupUploadSession(uploadSessionId);
            }
            failedCount += 1;
            continue;
          }
          const { storageId } = (await res.json()) as { storageId: string };
          uploadedStorageId = storageId;
          if (uploadSessionId && onBindUploadSession) {
            await onBindUploadSession(uploadSessionId, storageId);
          }
          committedBytesRef.current += file.size;
          setAttachments((prev) => [
            ...prev,
            {
              storageId: storageId as Id<"_storage">,
              uploadSessionId,
              name: file.name || `attachment.${mimeType.split("/")[1] || "bin"}`,
              type: attachmentTypeForMime(mimeType),
              mimeType,
              sizeBytes: file.size,
            },
          ]);
        } catch {
          if (uploadSessionId && onCleanupUploadSession) {
            await onCleanupUploadSession(uploadSessionId, uploadedStorageId);
          }
          failedCount += 1;
        } finally {
          inFlightBytesRef.current = Math.max(0, inFlightBytesRef.current - file.size);
        }
      }
      if (isVideoMode && supportsFrameImages) {
        setAttachments((prev) => assignDefaultVideoRoles(prev));
      }
      const totalErrors = failedCount + rejectedCount;
      if (totalErrors > 0) {
        setUploadError(
          rejectedCount > 0
            ? `${rejectedCount} file${rejectedCount === 1 ? "" : "s"} rejected. Check model support and the 25 MB total limit.`
            : `${failedCount} file${failedCount === 1 ? "" : "s"} failed to upload.`,
        );
      }
    } finally {
      setUploadCount((count) => Math.max(0, count - 1));
    }
  }, [onCreateUploadUrl, onBindUploadSession, onCleanupUploadSession, isVideoMode, supportsAudioInput, supportsFileInput, supportsFrameImages, supportsVision]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      await uploadFiles(Array.from(input.files ?? []));
      input.value = "";
    },
    [uploadFiles],
  );

  const removeAttachment = useCallback((index: number) => {
    const removed = attachmentsRef.current[index];
    if (removed?.uploadSessionId && onCleanupUploadSession) {
      void onCleanupUploadSession(removed.uploadSessionId, removed.storageId);
    }
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, [onCleanupUploadSession]);

  const changeAttachmentRole = useCallback((index: number, role: VideoRole) => {
    setAttachments((prev) => prev.map((att, i) => i === index ? { ...att, videoRole: role } : att));
  }, []);

  /** Re-assign default video roles to all image attachments (call when entering video mode). */
  const applyVideoRoles = useCallback(() => {
    setAttachments((prev) => assignDefaultVideoRoles(prev));
  }, []);

  /** Handle pasted files (e.g. images from clipboard via Ctrl+V / Cmd+V). */
  const handlePasteFiles = useCallback(
    (files: File[]) => uploadFiles(files.filter((file) => file.type.startsWith("image/"))),
    [uploadFiles],
  );

  const clear = useCallback(() => {
    if (onCleanupUploadSession) {
      for (const attachment of attachmentsRef.current) {
        if (attachment.uploadSessionId) {
          void onCleanupUploadSession(attachment.uploadSessionId, attachment.storageId);
        }
      }
    }
    setAttachments([]);
  }, [onCleanupUploadSession]);

  useEffect(() => () => {
    if (!onCleanupUploadSession) return;
    for (const attachment of attachmentsRef.current) {
      if (attachment.uploadSessionId) {
        void onCleanupUploadSession(attachment.uploadSessionId, attachment.storageId);
      }
    }
  }, [onCleanupUploadSession]);

  return {
    attachments,
    setAttachments,
    isUploading: uploadCount > 0,
    uploadError,
    setUploadError,
    fileInputRef,
    imageInputRef,
    cameraInputRef,
    handleFileSelect,
    handleFiles: uploadFiles,
    handlePasteFiles,
    removeAttachment,
    changeAttachmentRole,
    applyVideoRoles,
    clear,
  };
}
