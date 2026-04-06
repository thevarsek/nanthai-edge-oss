import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";

interface Args {
  chatId: string;
  isGenerating: boolean;
  isAutonomousActive: boolean;
  text: string;
  attachmentCount: number;
  isUploading: boolean;
  disabled: boolean;
  onSend: (args: { text: string; attachments?: AttachmentPreview[] }) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onQueueCommitted: () => void;
  onEditCommitted: (queuedText: string) => void;
}

export function useQueuedFollowUp({
  chatId,
  isGenerating,
  isAutonomousActive,
  text,
  attachmentCount,
  isUploading,
  disabled,
  onSend,
  onCancel,
  onQueueCommitted,
  onEditCommitted,
}: Args) {
  const [queuedFollowUp, setQueuedFollowUp] = useState<{ chatId: string; text: string } | null>(null);
  const [queuedActionState, setQueuedActionState] = useState<"idle" | "draining" | "interrupting">("idle");
  const isGeneratingRef = useRef(isGenerating);
  const activeQueuedFollowUp = queuedFollowUp?.chatId === chatId ? queuedFollowUp.text : null;

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    setQueuedFollowUp((current) => current?.chatId === chatId ? current : null);
    setQueuedActionState("idle");
  }, [chatId]);

  const canQueueMessage =
    !disabled &&
    !isAutonomousActive &&
    isGenerating &&
    text.trim().length > 0 &&
    attachmentCount === 0 &&
    !isUploading &&
    queuedActionState === "idle";

  const queueFollowUp = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || attachmentCount > 0 || isUploading) return;
    setQueuedFollowUp({ chatId, text: trimmed });
    onQueueCommitted();
  }, [attachmentCount, chatId, disabled, isUploading, onQueueCommitted, text]);

  const editQueuedFollowUp = useCallback(() => {
    if (!activeQueuedFollowUp || disabled) return;
    onEditCommitted(activeQueuedFollowUp);
    setQueuedFollowUp(null);
  }, [activeQueuedFollowUp, disabled, onEditCommitted]);

  const waitForGenerationToStop = useCallback(async () => {
    const deadline = Date.now() + 3_000;
    while (isGeneratingRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return !isGeneratingRef.current;
  }, []);

  const sendQueuedFollowUp = useCallback(async (queuedText: string) => {
    await onSend({ text: queuedText, attachments: [] });
  }, [onSend]);

  const sendQueuedNow = useCallback(async () => {
    if (!activeQueuedFollowUp || disabled || queuedActionState !== "idle") return;
    const nextQueued = { chatId, text: activeQueuedFollowUp };
    setQueuedFollowUp(null);
    setQueuedActionState("interrupting");
    try {
      await onCancel();
      const didStop = await waitForGenerationToStop();
      if (!didStop) {
        setQueuedFollowUp(nextQueued);
        return;
      }
      await sendQueuedFollowUp(nextQueued.text);
    } catch {
      setQueuedFollowUp(nextQueued);
    } finally {
      setQueuedActionState("idle");
    }
  }, [activeQueuedFollowUp, chatId, disabled, onCancel, queuedActionState, sendQueuedFollowUp, waitForGenerationToStop]);

  useEffect(() => {
    if (disabled || isGenerating || !activeQueuedFollowUp || queuedActionState !== "idle") return;
    const nextQueued = { chatId, text: activeQueuedFollowUp };
    setQueuedFollowUp(null);
    setQueuedActionState("draining");
    void (async () => {
      try {
        await sendQueuedFollowUp(nextQueued.text);
      } catch {
        setQueuedFollowUp((current) => current ?? nextQueued);
      } finally {
        setQueuedActionState("idle");
      }
    })();
  }, [activeQueuedFollowUp, chatId, disabled, isGenerating, queuedActionState, sendQueuedFollowUp]);

  return {
    queuedFollowUp: activeQueuedFollowUp,
    queuedActionState,
    canQueueMessage,
    queueFollowUp,
    editQueuedFollowUp,
    sendQueuedNow,
    removeQueuedFollowUp: () => {
      setQueuedFollowUp((current) => current?.chatId === chatId ? null : current);
    },
  };
}
