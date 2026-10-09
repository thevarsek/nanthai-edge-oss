import { useCallback, useRef, useState } from "react";
import type { VoiceCloningRequest } from "@/types/voiceCloning";
import type { RecordingResult } from "@/hooks/useAudioRecorder";
import { getChatDraft } from "@/stores/chatDraftStore";

/** Owns request-only voice selection and the recorder's explicit reference mode. */
export function useVoiceCloningDraft(chatId: string) {
  const [state, setState] = useState<{ chatId: string; value?: VoiceCloningRequest }>(() => ({
    chatId, value: getChatDraft(chatId).voiceCloning,
  }));
  const recordingReference = useRef(false);
  const [isRecordingReference, setRecordingReference] = useState(false);
  if (state.chatId !== chatId) {
    setState({ chatId, value: getChatDraft(chatId).voiceCloning });
  }
  const setValue = useCallback((value?: VoiceCloningRequest) => setState({ chatId, value }), [chatId]);
  const cancelReferenceRecording = useCallback(() => { recordingReference.current = false; setRecordingReference(false); }, []);
  const beginReferenceRecording = useCallback(() => { recordingReference.current = true; setRecordingReference(true); }, []);
  const consumeRecording = useCallback((result: RecordingResult | null): File | null => {
    const isReference = recordingReference.current;
    recordingReference.current = false;
    setRecordingReference(false);
    if (!result || !isReference) return null;
    const extension = result.mimeType.includes("mp4") ? "m4a" : result.mimeType.includes("ogg") ? "ogg" : "webm";
    return new File([result.blob], `voice-reference.${extension}`, { type: result.mimeType });
  }, []);
  return { isRecordingReference, value: state.chatId === chatId ? state.value : undefined, setValue,
    beginReferenceRecording, cancelReferenceRecording, consumeRecording };
}
