# Audio and generated media


### Audio Pipeline Overview

Audio message support spans three layers: Convex backend (TTS generation, storage), iOS client (recording, transcription, playback), and Android client (recording, transcription, playback).

### Backend Audio Pipeline

```
User taps "generate audio" or auto-audio triggers
    ↓
requestAudioGeneration mutation
    ↓
Sets audioGenerating: true on message
    ↓
Schedules generateAudioForMessage internal action
    ↓
Action: resolve the selected/default speech model and POST to OpenRouter `/api/v1/audio/speech`
    ↓
Receives provider-encoded audio response
    ↓
Preserve recognized encoded formats; wrap headerless PCM as WAV
    ↓
ctx.storage.store(audioBlob) → storageId
    ↓
Patches message: audioStorageId, audioVoice, audioGeneratedAt, audioGenerating: false
```

### Auto-Audio Trigger

Wired into `finalizeGenerationHandler` (the same hook used for push notifications):
- Checks `userPreferences.autoAudioResponse` or `chat.autoAudioResponseOverride`
- Only fires for non-scheduled, non-autonomous, assistant messages
- Respects the user's `preferredVoice` selection

### Voice Catalog

The synced model catalogue supplies `supportedVoices`. Settings display the
selected speech model's advertised voices and allow a provider voice ID where
the catalogue has no closed list. Speed, output format, instructions, style,
and style degree use the same capability-aware preference contract.

### iOS Audio Stack

- **Recording**: `AVAudioRecorder` with linear PCM format
- **Transcription**: `SFSpeechRecognizer` for real-time speech-to-text during recording
- **Playback**: `AVPlayer` with `AVAudioSession` configuration for playback category
- **UI**: Waveform visualization in message bubbles, inline playback controls
- **Integration**: `ChatViewModel+Attachments.swift` handles recording lifecycle, `ChatViewModel+Audio.swift` handles playback and generation requests

### Android Audio Stack

- **Recording**: `MediaRecorder` with AAC encoding
- **Transcription**: Android `SpeechRecognizer` API
- **Playback**: `MediaPlayer` with `DisposableEffect` Compose lifecycle management
- **UI**: Compose-native waveform + playback controls in chat detail

### Audio Message Schema Fields

Messages: `audioStorageId`, `audioMimeType`, `audioSource`, `audioTranscript`, `audioDurationMs`, `audioVoice`, `audioGeneratedAt`, `audioLastPlayedAt`, `audioGenerating`.
Preferences: `autoAudioResponse`, `preferredVoice`, the speech control defaults, and `defaultSpeechGenerationModelId`.
Chats: `autoAudioResponseOverride`.

---



### Lyria Audio Pipeline

Google Lyria models (`google/lyria-3-clip-preview` for 30s clips, `google/lyria-3-pro-preview` for full songs) produce MP3 audio from text prompts. The audio pipeline is entirely **server-side** — clients never handle raw audio bytes.

```
User sends prompt to Lyria model
  → Convex action streams from OpenRouter SSE
  → SSE parser detects delta.audio.data (single base64 MP3 chunk)
  → Stream completes → generateForParticipant() decodes base64
    → parseMp3DurationMs() walks MPEG frames for exact duration
    → ctx.storage.store(Blob) → audioStorageId
    → finalizeGeneration patches message: audioStorageId, audioDurationMs, audioGeneratedAt
    → Inserts generatedFiles record (toolName: "lyria_music_generation", mimeType: "audio/mpeg")
  → Clients reactively receive audioStorageId via Convex subscription
    → Query getMessageAudioUrl for signed storage URL → play audio
```

### Design constraints

- **Server-side storage** — audio is decoded and stored within the same Convex action that runs the SSE stream. No client-to-server upload needed.
- **MP3 format** — Lyria outputs MP3 directly (not PCM). No conversion step. The `parseMp3DurationMs()` function walks MPEG frame headers to extract exact duration.
- **Auto-audio suppression** — `finalizeGenerationHandler` skips `maybeScheduleAutoAudio` when `audioStorageId` is already present, preventing TTS from reading out music lyrics.
- **isFree detection** — Lyria models report $0 token prices but charge per-request. `isFree` now uses `:free` slug suffix across all platforms instead of zero-price check.
- **Knowledge Base** — generated audio files are registered in `generatedFiles` and downloadable via the `/download` HTTP endpoint (which now includes `mp3: "audio/mpeg"` MIME type).

### Client Audio Players

All three platforms have inline audio player components for Lyria messages:

| Platform | Component | Features |
|----------|-----------|----------|
| iOS | `AudioPlayerView.swift` | AVPlayer, play/pause, seekable progress bar, M:SS time, 6-speed (0.5x–2x), download via share sheet |
| Android | `LyriaAudioPlayer.kt` | MediaPlayer, play/pause, tap/drag-to-seek, M:SS time, 6-speed, download via Intent.ACTION_VIEW |
| Web | `AudioMessageBubble.tsx` (enhanced) | HTML5 Audio, existing waveform/progress/speed UI + download button + Lyria header |

Clients render stored audio whenever `audioStorageId` exists. `audioMimeType`
and `audioSource` are authoritative; clients do not infer the media contract
from a Lyria model slug.

---



M52 extends the existing skill resolver and progressive tool registry rather
than adding a second media orchestration layer:

```
User asks for media
  → normal chat/persona/scheduled-task skill resolution
  → load_skill exposes the matching media tool profile
  → generate_image | generate_music | generate_speech | generate_video
  → Convex resolves explicit model → user preference → MODEL_IDS default
  → synced capability and endpoint-specific ZDR projection
  → existing OpenRouter adapter and storage/artifact projection
  → shared message subscription renders the result on web, iOS, and Android
```

The four transports are intentionally narrow: dedicated Images API, Lyria via
chat completions, dedicated Speech API, and asynchronous Video API. Optional
tool arguments form a useful superset; Convex removes values the selected model
does not support before sending the request. Model IDs used as product defaults
live only in `convex/lib/model_constants.ts`.

Web and native settings consume the same `getPreferences` and
`listModelSummaries({ includeGenerationModels: true })` payloads. Pickers use
backend-authored `generationCapabilities`, `generationZdrCapabilities`, and
`mediaCapabilities`; unsupported controls stay visible but disabled. A saved
non-ZDR media selection stays visible when ZDR is enabled, while its skill is
unavailable and excluded from the model's tool context. There is no hidden
ZDR-specific fallback.

Image and video output reuse `generatedMedia`; music and speech reuse message
audio fields and `generatedFiles`. Existing storage-backed attachment handling
therefore lets generated media flow into PPTX, Gmail drafts, Google Drive, and
other capable tools. Provider usage is included in
`getChatCostSummary.breakdown.media`.

Video submission/polling remains an owned Convex Workflow-backed deferred tool.
If OpenRouter credentials disappear before continuation, the job fails
gracefully. Delayed provider-cost lookup remains the existing one-shot action,
not a new durable retry workload.

---
