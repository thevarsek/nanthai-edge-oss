// components/chat/MessageInput.tsx — Multi-line input with attachments, plus menu, @mention, recording.
// Matches iOS MessageInput.swift: "Message" placeholder, arrow.up.circle.fill send,
// mic.circle.fill record, circular plus button, 14px border radius.

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { ArrowUp, Square, Plus, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";
import { useMentionAutocomplete, type MentionSuggestion } from "@/hooks/useMentionAutocomplete";
import { useAudioRecorder, type RecordingResult } from "@/hooks/useAudioRecorder";
import { ChatPlusMenu, type PlusMenuItem } from "@/components/chat/ChatPlusMenu";
import { MentionAutocompletePopover } from "@/components/chat/MentionAutocompletePopover";
import { AudioRecordingOverlay } from "@/components/chat/AudioRecordingOverlay";
import {
  AttachmentPreviews,
  HiddenFileInputs,
} from "@/components/chat/MessageInput.attachments";
import { PendingFollowUpCard } from "@/components/chat/PendingFollowUpCard";
import { useQueuedFollowUp } from "@/components/chat/MessageInput.queue.hook";
import { useAttachments } from "@/components/chat/MessageInput.attachments.hook";
import type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";

export type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";

interface Props {
  chatId: Id<"chats">;
  participants: Participant[];
  isGenerating: boolean;
  onSend: (args: { text: string; attachments?: AttachmentPreview[] }) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onCreateUploadUrl: () => Promise<string>;
  onPlusMenuSelect?: (item: PlusMenuItem) => void;
  disabled?: boolean;
  plusMenuBadges?: Partial<Record<PlusMenuItem, number>>;
  isPro?: boolean;
  hasConnectedIntegrations?: boolean;
  participantCount?: number;
  hasMessages?: boolean;
  mentionSuggestions?: MentionSuggestion[];
  isAutonomousActive?: boolean;
  onIntervene?: (text: string) => void;
  onSendRecording?: (result: RecordingResult) => void;
  allParticipantsSupportTools?: boolean;
}

export function MessageInput({
  chatId,
  isGenerating, onSend, onCancel, onCreateUploadUrl, onPlusMenuSelect,
  disabled = false, plusMenuBadges = {}, isPro = false,
  hasConnectedIntegrations = false, participantCount = 1, hasMessages = false,
  mentionSuggestions = [], isAutonomousActive = false,
  onIntervene, onSendRecording, allParticipantsSupportTools = true,
}: Props) {
  const [text, setText] = useState("");
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation();

  const {
    attachments, isUploading, fileInputRef, imageInputRef, cameraInputRef,
    handleFileSelect, removeAttachment, clear: clearAttachments,
  } = useAttachments(onCreateUploadUrl);

  const mention = useMentionAutocomplete(mentionSuggestions);
  const [recorderState, recorder] = useAudioRecorder();

  const handleRecordStop = useCallback(async () => {
    const result = await recorder.stop();
    if (result && onSendRecording) onSendRecording(result);
  }, [recorder, onSendRecording]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, []);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      mention.onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
      resizeTextarea();
    },
    [resizeTextarea, mention],
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isGenerating) return;
    if (isAutonomousActive && onIntervene && trimmed) {
      onIntervene(trimmed);
    } else {
      await onSend({ text: trimmed, attachments });
    }
    setText("");
    clearAttachments();
    mention.dismiss();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, attachments, isGenerating, onSend, isAutonomousActive, onIntervene, clearAttachments, mention]);

  const {
    queuedFollowUp,
    queuedActionState,
    canQueueMessage,
    queueFollowUp,
    editQueuedFollowUp,
    sendQueuedNow,
    removeQueuedFollowUp,
  } = useQueuedFollowUp({
    chatId,
    isGenerating,
    isAutonomousActive,
    text,
    attachmentCount: attachments.length,
    isUploading,
    disabled,
    onSend,
    onCancel,
    onQueueCommitted: () => {
      setText("");
      mention.dismiss();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    },
    onEditCommitted: (queuedText) => {
      setText((current) => {
        const trimmedCurrent = current.trim();
        return trimmedCurrent ? `${current}\n${queuedText}` : queuedText;
      });
      requestAnimationFrame(() => {
        resizeTextarea();
        textareaRef.current?.focus();
      });
    },
  });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention.isActive) {
        if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)) return;
      }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, attachments, mention.isActive, handleSend],
  );

  const handlePlusMenuSelect = useCallback(
    (item: PlusMenuItem) => {
      if (item === "file") fileInputRef.current?.click();
      else if (item === "image") imageInputRef.current?.click();
      else if (item === "camera") cameraInputRef.current?.click();
      else onPlusMenuSelect?.(item);
    },
    [onPlusMenuSelect, fileInputRef, imageInputRef, cameraInputRef],
  );

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isGenerating && !isUploading;
  const canRecord = !!onSendRecording && !isGenerating && !isUploading && !disabled;

  // ── Recording mode — replaces normal input ──────────────────────────────────
  if (recorderState.isRecording || recorderState.isPreparing) {
    return (
      <AudioRecordingOverlay
        elapsedMs={recorderState.elapsedMs} levels={recorderState.levels}
        interimTranscript={recorderState.interimTranscript}
        onStop={handleRecordStop} onCancel={recorder.cancel}
      />
    );
  }

  return (
    <div className="border-t border-border/30 bg-background px-4 py-3">
      {queuedFollowUp && (
        <PendingFollowUpCard
          text={queuedFollowUp}
          isSendingNow={queuedActionState === "interrupting"}
          actionsDisabled={disabled}
          onEdit={editQueuedFollowUp}
          onSendNow={() => { void sendQueuedNow(); }}
          onRemove={removeQueuedFollowUp}
        />
      )}

      <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />

      <div className="flex items-center gap-2">
        {/* Plus button — iOS: circular glass effect */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowPlusMenu((v) => !v)}
            disabled={disabled || isUploading}
            className="w-10 h-10 rounded-full bg-surface-2/50 backdrop-blur-sm border border-border/20 flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-40"
            title={t("more_options")}
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
          {showPlusMenu && (
            <ChatPlusMenu
              onSelect={handlePlusMenuSelect}
              onClose={() => setShowPlusMenu(false)}
              badges={plusMenuBadges} isPro={isPro}
              hasConnectedIntegrations={hasConnectedIntegrations}
              participantCount={participantCount} hasMessages={hasMessages}
              allParticipantsSupportTools={allParticipantsSupportTools}
            />
          )}
        </div>

          <HiddenFileInputs fileInputRef={fileInputRef} imageInputRef={imageInputRef} cameraInputRef={cameraInputRef} onSelect={handleFileSelect} />

        {/* Text input — iOS: cornerRadius 14, glass effect */}
        <div className="flex-1 relative self-end">
          {mention.isActive && (
            <MentionAutocompletePopover
              suggestions={mention.suggestions}
              onSelect={(s) => mention.insertMention(s, text, setText, textareaRef)}
              onDismiss={mention.dismiss}
            />
          )}
          <textarea
            ref={textareaRef} value={text}
            onChange={handleTextChange} onKeyDown={handleKeyDown}
            placeholder={isAutonomousActive ? t("send_message_intervene") : isGenerating ? t("generating") : t("message")}
            disabled={disabled} rows={1}
            className="w-full resize-none rounded-[14px] bg-surface-2/50 backdrop-blur-sm border border-border/20 px-4 py-2.5 text-sm text-foreground placeholder-foreground/40 focus:outline-none focus:border-primary/50 focus:bg-surface-2/80 transition-colors max-h-48 min-h-[44px] leading-relaxed disabled:opacity-50"
            style={{ height: "auto" }}
          />
        </div>

        {/* Send / Stop / Mic — iOS: .title2 filled circle icons */}
        {canQueueMessage ? (
          <button
            type="button"
            onClick={queueFollowUp}
            className="w-10 h-10 rounded-full bg-accent/10 text-accent hover:bg-accent/20 transition-colors shrink-0 flex items-center justify-center"
            title={t("queue_follow_up")}
            aria-label={t("queue_follow_up")}
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
        ) : isGenerating ? (
          <button onClick={() => { void onCancel(); }} className="w-10 h-10 rounded-full bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors shrink-0 flex items-center justify-center" title={t("stop_generation")}>
            <Square size={16} fill="currentColor" />
          </button>
        ) : canSend ? (
          <button onClick={() => void handleSend()} className="w-10 h-10 rounded-full bg-primary text-white hover:opacity-90 transition-opacity shrink-0 flex items-center justify-center" title="Send (Enter)">
            <ArrowUp size={20} strokeWidth={2.5} />
          </button>
        ) : canRecord ? (
          <button onClick={() => void recorder.start()} className="w-10 h-10 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors shrink-0 flex items-center justify-center" title={t("record_voice")}>
            <Mic size={18} />
          </button>
        ) : (
          <button disabled className="w-10 h-10 rounded-full bg-primary text-white opacity-30 cursor-not-allowed shrink-0 flex items-center justify-center" title="Send (Enter)">
            <ArrowUp size={20} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {isUploading && <p className="text-xs text-muted mt-1 ml-12">{t("uploading")}</p>}
      {recorderState.error && <p className="text-xs text-destructive mt-1 ml-12">{recorderState.error}</p>}
    </div>
  );
}
