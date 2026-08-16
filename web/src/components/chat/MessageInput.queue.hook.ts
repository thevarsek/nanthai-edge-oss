import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";
import type { QueuedAdvisorSnapshot } from "@/advisors/types";

interface QueuedFollowUp {
  id: string;
  chatId: string;
  text: string;
  attachments: AttachmentPreview[];
  advisorSnapshot?: QueuedAdvisorSnapshot;
}

interface Args {
  chatId: string;
  isGenerating: boolean;
  isCollaborationActive?: boolean;
  isAutonomousActive: boolean;
  text: string;
  attachmentCount: number;
  queuedAttachments?: AttachmentPreview[];
  isUploading: boolean;
  disabled: boolean;
  onSend: (args: {
    text: string;
    attachments?: AttachmentPreview[];
    advisorSnapshot?: QueuedAdvisorSnapshot;
  }) => boolean | void | Promise<boolean | void>;
  onCancel: () => void | Promise<void>;
  onQueueCommitted: () => void;
  onEditCommitted: (queuedText: string) => void;
  canCaptureQueuedAdvisorSnapshot?: boolean;
  hasEphemeralContext?: boolean;
  captureQueuedAdvisorSnapshot?: () => QueuedAdvisorSnapshot | null;
  restoreQueuedAdvisorSnapshot?: (snapshot: QueuedAdvisorSnapshot) => void;
}

function copyAdvisorSnapshot(
  snapshot: QueuedAdvisorSnapshot | undefined,
): QueuedAdvisorSnapshot | undefined {
  if (!snapshot) return undefined;
  return {
    advisorSelections: snapshot.advisorSelections.map((selection) => ({ ...selection })),
    ...(snapshot.advisorBrief !== undefined ? { advisorBrief: snapshot.advisorBrief } : {}),
  };
}

export function useQueuedFollowUp({
  chatId,
  isGenerating,
  isCollaborationActive = false,
  isAutonomousActive,
  text,
  attachmentCount,
  queuedAttachments = [],
  isUploading,
  disabled,
  onSend,
  onCancel,
  onQueueCommitted,
  onEditCommitted,
  canCaptureQueuedAdvisorSnapshot = true,
  hasEphemeralContext = false,
  captureQueuedAdvisorSnapshot,
  restoreQueuedAdvisorSnapshot,
}: Args) {
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [queuedActionState, setQueuedActionState] = useState<"idle" | "draining" | "interrupting">("idle");
  const isBusy = isGenerating || isCollaborationActive;
  const isGeneratingRef = useRef(isBusy);
  const chatIdRef = useRef(chatId);
  const didDrainForCurrentIdleRef = useRef(false);
  const activeQueuedFollowUps = useMemo(
    () => queuedFollowUps.filter((queued) => queued.chatId === chatId),
    [chatId, queuedFollowUps],
  );
  const activeQueuedFollowUp = activeQueuedFollowUps[0]?.text ?? null;

  useLayoutEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueuedFollowUps((current) => current.filter((queued) => queued.chatId === chatId));
      setQueuedActionState("idle");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [chatId]);

  useEffect(() => {
    isGeneratingRef.current = isBusy;
    if (isBusy) {
      didDrainForCurrentIdleRef.current = false;
    }
  }, [isBusy]);

  const canQueueMessage =
    !disabled &&
    !isAutonomousActive &&
    isBusy &&
    text.trim().length > 0 &&
    attachmentCount === 0 &&
    !isUploading &&
    canCaptureQueuedAdvisorSnapshot &&
    !hasEphemeralContext &&
    queuedActionState === "idle";

  const queueFollowUp = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || attachmentCount > 0 || isUploading || !canCaptureQueuedAdvisorSnapshot || hasEphemeralContext) return;
    const capturedAdvisorSnapshot = captureQueuedAdvisorSnapshot?.();
    if (capturedAdvisorSnapshot === null) return;
    const advisorSnapshot = copyAdvisorSnapshot(capturedAdvisorSnapshot);
    if (isCollaborationActive) {
      setQueuedActionState("draining");
      try {
        const result = await onSend({
          text: trimmed,
          attachments: queuedAttachments,
          ...(advisorSnapshot ? { advisorSnapshot } : {}),
        });
        if (result !== false && chatIdRef.current === chatId) {
          onQueueCommitted();
        }
      } catch {
        // The send path owns user-visible error reporting; keep the draft intact.
      } finally {
        setQueuedActionState("idle");
      }
      return;
    }
    setQueuedFollowUps((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        chatId,
        text: trimmed,
        attachments: queuedAttachments,
        advisorSnapshot,
      },
    ]);
    onQueueCommitted();
  }, [attachmentCount, canCaptureQueuedAdvisorSnapshot, captureQueuedAdvisorSnapshot, chatId, disabled, hasEphemeralContext, isCollaborationActive, isUploading, onQueueCommitted, onSend, queuedAttachments, text]);

  const editQueuedFollowUp = useCallback((id?: string) => {
    const queued = activeQueuedFollowUps.find((item) => item.id === id) ?? activeQueuedFollowUps[0];
    if (!queued || disabled) return;
    onEditCommitted(queued.text);
    if (queued.advisorSnapshot) restoreQueuedAdvisorSnapshot?.(queued.advisorSnapshot);
    setQueuedFollowUps((current) => current.filter((item) => item.id !== queued.id));
  }, [activeQueuedFollowUps, disabled, onEditCommitted, restoreQueuedAdvisorSnapshot]);

  const waitForGenerationToStop = useCallback(async () => {
    const deadline = Date.now() + 3_000;
    while (isGeneratingRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return !isGeneratingRef.current;
  }, []);

  const sendQueuedFollowUp = useCallback(async (queued: QueuedFollowUp) => {
    if (chatIdRef.current !== queued.chatId) return false;
    const result = await onSend({
      text: queued.text,
      attachments: queued.attachments,
      ...(queued.advisorSnapshot ? { advisorSnapshot: queued.advisorSnapshot } : {}),
    });
    return result !== false;
  }, [onSend]);

  const sendQueuedNow = useCallback(async (id?: string) => {
    const nextQueued = activeQueuedFollowUps.find((item) => item.id === id) ?? activeQueuedFollowUps[0];
    if (!nextQueued || disabled || queuedActionState !== "idle") return;
    setQueuedFollowUps((current) => current.filter((item) => item.id !== nextQueued.id));
    setQueuedActionState("interrupting");
    try {
      await onCancel();
      const didStop = await waitForGenerationToStop();
      if (!didStop) {
        setQueuedFollowUps((current) => [nextQueued, ...current]);
        return;
      }
      const didSend = await sendQueuedFollowUp(nextQueued);
      if (!didSend) {
        setQueuedFollowUps((current) => [nextQueued, ...current]);
      }
    } catch {
      if (chatIdRef.current === nextQueued.chatId) {
        setQueuedFollowUps((current) => [nextQueued, ...current]);
      }
    } finally {
      setQueuedActionState("idle");
    }
  }, [activeQueuedFollowUps, disabled, onCancel, queuedActionState, sendQueuedFollowUp, waitForGenerationToStop]);

  useEffect(() => {
    const nextQueued = activeQueuedFollowUps[0];
    if (disabled || isBusy || !nextQueued || queuedActionState !== "idle") return;
    if (didDrainForCurrentIdleRef.current) return;
    didDrainForCurrentIdleRef.current = true;
    setQueuedFollowUps((current) => current.filter((item) => item.id !== nextQueued.id));
    setQueuedActionState("draining");
    void (async () => {
      try {
        const didSend = await sendQueuedFollowUp(nextQueued);
        if (!didSend && chatIdRef.current === nextQueued.chatId) {
          setQueuedFollowUps((current) => [nextQueued, ...current]);
        }
      } catch {
        if (chatIdRef.current === nextQueued.chatId) {
          setQueuedFollowUps((current) => [nextQueued, ...current]);
        }
      } finally {
        setQueuedActionState("idle");
      }
    })();
  }, [activeQueuedFollowUps, disabled, isBusy, queuedActionState, sendQueuedFollowUp]);

  return {
    queuedFollowUp: activeQueuedFollowUp,
    queuedFollowUps: activeQueuedFollowUps,
    queuedActionState,
    canQueueMessage,
    queueFollowUp,
    editQueuedFollowUp,
    sendQueuedNow,
    removeQueuedFollowUp: (id?: string) => {
      const queued = activeQueuedFollowUps.find((item) => item.id === id) ?? activeQueuedFollowUps[0];
      if (!queued) return;
      if (queued.advisorSnapshot) restoreQueuedAdvisorSnapshot?.(queued.advisorSnapshot);
      setQueuedFollowUps((current) => current.filter((item) => item.id !== queued.id));
    },
  };
}
