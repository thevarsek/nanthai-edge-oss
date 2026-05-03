# Testing Strategy

NanthAI Edge uses Convex as the shared product API and keeps client tests focused on rendering, local interaction state, and decoding shared payloads.

## Test Pyramid

| Layer | Purpose | Command |
| --- | --- | --- |
| Convex unit/contract | Shared product rules, payloads, error contracts | `npm run convex:test` |
| Web unit/component | Fast helper and React surface coverage with seeded data | `cd web && npm run test` |
| Web E2E smoke | Browser canary for public shell and native relay routes | `cd web && npm run test:e2e` |
| Android JVM unit | ViewModel, repository mapping, DTO decoding | `cd android && ./gradlew testDebugUnitTest` |
| Android Compose UI | Targeted chat/settings smoke tests without live auth | `cd android && ./gradlew connectedDebugAndroidTest` |
| Android performance | Physical-device startup/frame timing and Baseline Profile generation | `cd android && ./gradlew :baselineprofile:connectedBenchmarkAndroidTest` / `cd android && ./gradlew :app:generateBaselineProfile` |
| iOS build/tests | Build gate for Swift changes; tests where simulator is stable | AGENTS.md iOS commands |

## M34 Coverage Defaults

- Web uses Vitest + React Testing Library for helper/component tests and Playwright for a small browser smoke suite.
- Web tests must not require live Clerk user state. Authenticated journey coverage should use mocked Convex/Clerk data until a dedicated test account flow exists.
- Android Compose UI tests mount focused composables with seeded data instead of launching production Clerk/Convex.
- Android chat/list refactors should add fast owner tests before moving behavior. Current coverage includes chat-list filtering, feed/pagination/loading, default/favorite creation, list actions, folder cleanup, share nonce processing, selection state, and pinned reorder state.
- Android performance work uses physical-device Macrobenchmark/Baseline Profile results. Emulator runs are command validation only.
- Android Macrobenchmark launches `benchmarkScenario=chatShell`, a seeded benchmark-only chat surface available only in debug/benchmark builds. This keeps frame timing independent of persisted Clerk/OpenRouter login state while exercising production chat-detail content/timeline rendering.
- Shared generated-document payloads live in `fixtures/m34/document_artifacts.json`; numeric fields use floating-point literals to match Convex wire behavior.
- Document workflow events are decoded permissively on clients. Only events with `storageId`, `filename`, and `mimeType` are treated as generated-file attachment suggestions.

## Core Journey Ownership

| Journey | Convex | Web | Android | iOS |
| --- | --- | --- | --- | --- |
| Authenticated shell loads | Auth/session contracts | Playwright smoke with mocked app shell | Compose/root smoke without live auth | Build gate; UI smoke only when simulator is stable |
| Chat list search/filter/pin surfaces | Shared ordering and flags | Component/route tests with seeded chats | Owner/unit tests plus Compose chat-list smoke with seeded rows | Existing ViewModel/unit coverage unless touched |
| Chat detail pending/streaming/final/error | Message status and retry contract | Component/route tests with seeded states | Compose detail smoke and later long-chat perf fixture | DTO/ViewModel tests for changed shared fields |
| Generated document cards | Generated-file query and document events | Vitest card tests and attachment guard tests | Compose card smoke and DTO fixture tests | DTO fixture tests and existing card rendering |
| Knowledge Base list/picker | KB queries and file metadata | Component or route tests with seeded files | Compose picker/list smoke where practical | Targeted tests only when KB contract changes |
| Model/persona/default selection | Preference/default resolution | Helper/component tests | ViewModel/unit tests and picker smoke | Existing Swift tests plus touched contract coverage |
| Error extraction and retry state | Structured `ConvexError` and retry fields | Helper tests | JVM extractor/ViewModel tests | Swift extractor/ViewModel tests |

## Android Performance Policy

- Haze/glass remains the default visual direction.
- JankStats runs only in debug and `benchmark` builds and logs janky frames under the `NanthPerf` tag.
- Macrobenchmark captures startup, chat scroll, list/detail/back transition, and keyboard open/close frame timing on the seeded chat shell. Before/after numbers should be recorded in `milestones/M34-web-tests-android-ui-performance.md`.
- Route-level animations around heavy chat surfaces are performance-sensitive. Reintroducing broad `AnimatedPane`/`AnimatedContent` wrappers around list/detail/timeline content should include a physical-device macrobenchmark comparison.
- Haze stays enabled on devices/API levels that support blur; physical-device performance work should fix source placement, compositing, and surrounding list/IME work rather than disabling Haze during movement, sends, or scroll.
