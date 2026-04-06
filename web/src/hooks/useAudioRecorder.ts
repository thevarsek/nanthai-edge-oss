// hooks/useAudioRecorder.ts — MediaRecorder + Web Audio AnalyserNode + Web Speech API transcription.
// Provides recording state, waveform levels, elapsed time, and produces a Blob + transcript on stop.

import { useCallback, useRef, useState, useEffect } from "react";

// Web Speech API types — not in lib.dom for all TS configs.
interface SpeechRecognitionCompat {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  start: () => void;
  stop: () => void;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  transcript: string;
}

export interface AudioRecorderState {
  isRecording: boolean;
  isPreparing: boolean;
  elapsedMs: number;
  /** 0–1 normalized waveform levels (16 bars, updated ~8 fps). */
  levels: number[];
  /** Interim speech recognition transcript. */
  interimTranscript: string;
  error: string | null;
}

export interface AudioRecorderActions {
  start: () => Promise<void>;
  stop: () => Promise<RecordingResult | null>;
  cancel: () => void;
}

const MAX_DURATION_MS = 120_000; // 2 minutes
const LEVEL_BARS = 16;
const LEVEL_INTERVAL_MS = 125; // ~8 fps

/** Picks the best supported MIME type for MediaRecorder. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return ""; // browser default
}

/** Creates a SpeechRecognition instance if available. */
function createRecognition(): SpeechRecognitionCompat | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = window as any;
  const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!SR) return null;
  const r: SpeechRecognitionCompat = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-US";
  return r;
}

export function useAudioRecorder(): [AudioRecorderState, AudioRecorderActions] {
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionCompat | null>(null);
  const finalTranscriptRef = useRef("");
  /** Full transcript (final + interim) — what the user sees in the overlay. */
  const fullTranscriptRef = useRef("");
  const mimeTypeRef = useRef("");
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Resolve the stop() promise when mediaRecorder fires onstop.
  const stopResolveRef = useRef<((r: RecordingResult | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (levelTimerRef.current) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current?.state !== "closed") void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    finalTranscriptRef.current = "";
    fullTranscriptRef.current = "";
    setIsRecording(false);
    setIsPreparing(false);
    setElapsedMs(0);
    setLevels(Array(LEVEL_BARS).fill(0));
    setInterimTranscript("");
  }, []);

  // Cleanup on unmount
  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setIsPreparing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Audio analyser for waveform
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      // MediaRecorder
      const mime = pickMimeType();
      mimeTypeRef.current = mime;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current || "audio/webm",
        });
        const durationMs = Date.now() - startTimeRef.current;
        // Use the full transcript (final + interim) — the Web Speech API may not
        // have finalized all segments by the time the user stops recording.
        const transcript = (fullTranscriptRef.current || finalTranscriptRef.current).trim();
        const result: RecordingResult = {
          blob,
          mimeType: mimeTypeRef.current || "audio/webm",
          durationMs,
          transcript,
        };
        if (stopResolveRef.current) {
          stopResolveRef.current(result);
          stopResolveRef.current = null;
        }
        cleanup();
      };

      // Speech recognition (best-effort)
      const recognition = createRecognition();
      if (recognition) {
        recognitionRef.current = recognition;
        recognition.onresult = (ev) => {
          let finalText = "";
          let interimText = "";
          for (let i = 0; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interimText += r[0].transcript;
          }
          finalTranscriptRef.current = finalText;
          fullTranscriptRef.current = finalText + interimText;
          setInterimTranscript(finalText + interimText);
        };
        recognition.onerror = () => { /* non-fatal — transcript is optional */ };
        recognition.start();
      }

      // Start recording
      recorder.start(250); // collect chunks every 250ms
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setIsPreparing(false);

      // Elapsed timer
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      // Waveform level sampling
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      levelTimerRef.current = setInterval(() => {
        analyser.getByteFrequencyData(freqData);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(freqData.length / LEVEL_BARS));
        for (let i = 0; i < LEVEL_BARS; i++) {
          const idx = Math.min(i * step, freqData.length - 1);
          bars.push(freqData[idx] / 255);
        }
        setLevels(bars);
      }, LEVEL_INTERVAL_MS);

      // Auto-stop at max duration
      maxTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, MAX_DURATION_MS);
    } catch (err) {
      cleanup();
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(msg.includes("Permission") || msg.includes("NotAllowed") ? "Microphone access denied. Please allow microphone in your browser settings." : msg);
    }
  }, [cleanup]);

  const stop = useCallback((): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
        resolve(null);
        return;
      }
      stopResolveRef.current = resolve;
      mediaRecorderRef.current.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    stopResolveRef.current = null;
    if (mediaRecorderRef.current?.state === "recording") {
      // Override onstop to prevent resolving
      mediaRecorderRef.current.onstop = () => cleanup();
      mediaRecorderRef.current.stop();
    } else {
      cleanup();
    }
  }, [cleanup]);

  const state: AudioRecorderState = {
    isRecording, isPreparing, elapsedMs, levels, interimTranscript, error,
  };
  const actions: AudioRecorderActions = { start, stop, cancel };
  return [state, actions];
}
