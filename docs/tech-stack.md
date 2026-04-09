# Technology Stack

> Technologies used in NanthAI Edge across the native iOS app, native Android app, and shared Convex backend.

## Stack Overview

| Component | Technology | Version |
|-----------|-----------|---------|
| Language | Swift | 6.x toolchain via Xcode 26.2 beta |
| UI | SwiftUI | Latest (deployment target iOS 26+) |
| Backend | Convex | 1.32.0 (TypeScript functions) |
| Realtime Client | ConvexMobile (`convex-swift`) | 0.8.1 (SPM) |
| Identity Auth | Clerk iOS SDK (`ClerkKit` + `ClerkKitUI`) | Latest (SPM) |
| Auth UI (Identity) | `ClerkKitUI.AuthView` | Clerk-managed sign-in/sign-up |
| Auth UI (API Key) | ASWebAuthenticationSession | PKCE flow for OpenRouter key provisioning |
| Secrets | Security.framework (Keychain) | Built-in |
| Networking | ConvexMobile WebSocket | Reactive subscriptions, mutations, actions |
| Canvas (Ideascapes) | SwiftUI Canvas / GeometryReader | Built-in |
| Markdown | AttributedString (Foundation) | iOS 26+ (by app baseline) |
| Testing | XCTest + Swift Testing | Built-in |

### Android Client Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Language | Kotlin | 2.2.20 |
| UI | Jetpack Compose + Material 3 | Compose BOM 2025.06.00 |
| State | `ViewModel` + `StateFlow` | AndroidX Lifecycle current |
| Navigation | Navigation Compose | AndroidX current |
| Concurrency | Kotlin coroutines | Current |
| Build | Android Gradle Plugin | 9.1.0 |
| Identity Auth | Clerk Android SDK | 1.0.10 |
| Realtime/Data | Convex Kotlin SDK | 0.8.0 |
| Secure Storage | Android Keystore wrapper | Built-in |
| Billing | Google Play Billing client | Native Android billing path |
| Push | Firebase Cloud Messaging | Native Android push path |
| Min SDK | Android 9 | API 28 |
| Target SDK | Android 16 | API 36 |
| Testing | JUnit + JVM ViewModel tests | Local verification gate |

### Convex Backend Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Convex | 1.32.0 |
| AI Agent | @convex-dev/agent | 0.3.2 |
| AI SDK | ai (Vercel) | 5.0.138 |
| OpenAI Provider | @ai-sdk/openai | 3.0.33 |
| Helpers | convex-helpers | 0.1.113 |
| Validation | zod | ^4.3.6 |
| CalDAV Client | tsdav | ^2.1.8 |
| Document Generation | docx | ^9.6.0 |
| Presentation Generation | pptxgenjs | ^4.0.1 |
| Compaction Model | google/gemini-3.1-flash-lite-preview (via OpenRouter) | Used for context compaction in tool-call loops |
| TTS Model | openai/gpt-audio-mini (via OpenRouter) | Text-to-speech for audio messages (M20) |
| Workspace Runtime | just-bash | Per-generation ephemeral sandbox for shell commands and file operations (M27) |
| Lightweight Analytics | Pyodide (WASM) | In-process Python for data analysis, matplotlib charts (M27) |
| Heavy Analytics | Vercel Sandbox (@anthropic-ai/sdk) | Cloud sandbox for packages exceeding Pyodide capabilities (M27) |

### iOS Audio Stack (M20)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Recording | AVAudioRecorder (AVFoundation) | Linear PCM format |
| Transcription | SFSpeechRecognizer (Speech framework) | Real-time speech-to-text during recording |
| Playback | AVPlayer (AVFoundation) | Audio session configured for playback category |

### Android Audio Stack (M20)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Recording | MediaRecorder | AAC encoding |
| Transcription | SpeechRecognizer | Android speech API |
| Playback | MediaPlayer | DisposableEffect lifecycle in Compose |

### External Integration API Pattern (M10)

All Google Workspace, Microsoft 365, and Notion API calls use raw `fetch()` — **no Node.js SDKs** (`googleapis`, `@microsoft/microsoft-graph-client`, `@notionhq/client`). This avoids large dependency trees and keeps tools runnable in Convex's default V8 runtime without `"use node"` directives.

| Integration | Auth Pattern | Token Storage |
|-------------|-------------|---------------|
| Google Workspace | OAuth 2.0 PKCE (public client) | Convex `oauthConnections` table |
| Microsoft 365 | OAuth 2.0 PKCE (public/native client, no client_secret) | Convex `oauthConnections` table |
| Notion | OAuth 2.0 with HTTP Basic Auth (`base64(client_id:client_secret)`) | Convex `oauthConnections` table |

### Push Notifications (M13.5 + M16)

Push notifications use provider-native APIs called from Convex actions — no third-party push libraries.

| Component | Technology | Notes |
|-----------|-----------|-------|
| JWT Signing | WebCrypto (`crypto.subtle`) ES256 | P8 key converted to JWK at runtime; DER-to-raw signature conversion |
| APNs Transport | `fetch()` to `api.sandbox.push.apple.com` / `api.push.apple.com` | HTTP/2 with bearer token auth |
| FCM Transport | `fetch()` to `https://fcm.googleapis.com/fcm/send` | Legacy HTTP endpoint with server key auth (`FCM_SERVER_KEY`); 2xx responses must parse valid JSON and expose no per-token error to be logged as success |
| Token Storage | Convex `deviceTokens` table | Per-user, per-provider (`apns` / `fcm`), APNs environment-aware |
| iOS Registration | `UIApplicationDelegate` + `NotificationService` | Token hex-encoded, sent to Convex on registration and sign-in |
| Android Registration | FCM token lifecycle repository | Token sent to Convex with `platform: "android"` + `provider: "fcm"` |
| Deep Links | `UNUserNotificationCenter` delegate / Android intent routing | `chatId` included in provider payload for navigation handoff |

No Node.js runtime needed — all JWT signing and APNs calls run in Convex's default V8 runtime using `crypto.subtle`.

## Deployment Target Policy

- iOS minimum deployment target for v1: **iOS 26.0** (iPhone and iPad).
- Android minimum SDK for v1: **API 28 / Android 9**.
- Android target/compile SDK for the current branch: **API 36**.
- Build with latest Xcode/iOS SDK and current Android SDK; platform-native APIs are allowed within those baselines.
- Acceptance testing runs on:
  - one iOS 26.0 simulator/device
  - one iOS 26.2 simulator/device
  - one Android emulator or device on the current release branch

## Dependency Policy

- **Clerk iOS SDK** (`ClerkKit` + `ClerkKitUI`) — managed identity, session tokens, pre-built sign-in UI
- **ConvexMobile** (`convex-swift`) — realtime subscriptions, mutations, actions over WebSocket with Clerk JWT auth
- No other SPM dependencies. All other functionality uses Apple platform frameworks.
- URLSession used only for OpenRouter credits check (simple GET) and PKCE key exchange
- Security.framework for Keychain access
- Minimal dependencies = faster builds, smaller binary, reduced supply chain risk

## What Changed in M8

| Before (M0–M7.5) | After (M8) |
|-------------------|------------|
| SwiftData + CloudKit for persistence | Convex tables (server-side) |
| Direct OpenRouter API calls from device | Convex Actions call OpenRouter server-side |
| SSE parsing on device (`SSEParser`) | Server writes chunks; client subscribes to queries |
| `URLSession.AsyncBytes` streaming | ConvexMobile WebSocket subscriptions |
| `NaturalLanguage.framework` tokenization | Server-side context building |
| 8+ service protocols | Single `ConvexService` gateway |
| `ModelContainer` at app root | No SwiftData at all |

---

*Last updated: 2026-04-09 — M27 replaced E2B with three-tier free execution (just-bash, Pyodide, Vercel Sandbox). M20 audio stacks (iOS AVFoundation/Speech, Android MediaRecorder/SpeechRecognizer), and `gpt-audio-mini` TTS model.*
