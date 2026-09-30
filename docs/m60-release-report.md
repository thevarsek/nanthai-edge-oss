# M60 implementation and release report — 2026-09-30

M60 is implemented on `codex/m60-jev-decisions`, based on `origin/main` at `68e23215a7fdc3a58f5c56a8408073bb4fa69166`. M60 and its Android cleanup are merged. The user authorized release; the production backend deployment and live smoke checks succeeded on 2026-09-30 at main `79652245a4d16e3366976dbb8b23cca83476816e`. M59 and the parked runtime work have not been changed.

## Delivered behavior

- All four integrations run for everyone upon release, without feature flags. Existing eligible helper fallback remains for unavailable, malformed or uncertain decisions.
- Collaboration combines Jev speaker/reply-target judgments with the existing eligibility, human-frontier, budget, dispatch and replay policy. It can select one or multiple speakers, or return the floor.
- Autonomous discussions distinguish substantive agreement from stalled repetition. With the existing auto-stop option enabled, the backend can emit `completed_consensus` or `completed_stalled`; iOS, Android and Web display matching terminal states and clean up subscriptions. With auto-stop disabled, existing cycle limits apply.
- Moderator selection guides the configured generative moderator or skips an unnecessary intervention. The configured model/persona and directive validation remain in use.
- Memory reconciles admitted evidence against a bounded set of owned active global facts. It reinforces paraphrases, preserves coexisting scopes, and atomically supersedes changed facts while retaining provenance/history. Existing pending approval, pins, manual edits and settings remain authoritative. Explicit English/Italian forget commands resolve one owned target through the existing deletion/embedding/relationship cleanup; inferred contradiction cannot hard-delete.
- The alpha Decisions adapter uses the per-user OpenRouter credential and effective ZDR policy. It validates answers, has bounded context/timeout and no internal retry. Decisions request IDs are attributed separately from chat Generation IDs. Unknown cost remains unknown, without applying cached chat-model pricing.
- Existing moderator generation and consensus fallback usage is now attributed too, including returned paid fallback results. Deletion clears reciprocal supersession references without reactivating obsolete facts.

The M60 feature introduced no dependencies, picker, editor, restrictions or user approval screens. Release metadata is now prepared at the user's direction: iOS 1.1.36 (178) and Android 1.1.27 (118). Main has Android build 117 and iOS build 175; the explicit iOS build 178 accounts for the user-reported successful Xcode Cloud build 177. Additive schema changes are the stalled status and a small source-message replay journal. New decision/context/reconciliation owners are below 300 lines; existing large schema/mutation owners receive narrow relevant hooks only.

## Verification

| Surface | Result |
|---|---|
| Backend | **2,841 tests passed**, zero failures; TypeScript and ESLint clean |
| Web | **1,070 tests / 242 files passed**; ESLint, TypeScript and production/PWA build passed |
| iOS | arm64 Debug simulator build; **8 focused tests passed**, Italian `it/IT`, iPhone 17 Pro / iOS 26.5 |
| Android | Debug, release and benchmark builds passed; **883 JVM tests passed**; **48 selected Android 16 device cases passed across the initial run and recovered-emulator retry**. See the cleanup report for the initial focus failure. |
| Android lint | Fresh run: **0 errors, 35 warnings**. Eight punctuation and 27 dependency/platform-policy notices await explicit decisions; the zero-warning gate remains unresolved. See [cleanup status](m60-android-lint-cleanup.md), [remaining inventory](m60-android-lint-remaining.csv) and [original inventory](m60-android-lint-inventory.csv). |

Web browser proof covers a normal reply, two-model parallel replies, two live Collaboration exchanges, validated Jev decisions persisted before dispatch, quiet return-to-user behavior, two-cycle completion with auto-stop disabled, and one-cycle substantive arithmetic consensus with auto-stop enabled. The visible result was **“ENDED Consensus reached.”**

Merged implementation: [PR #115](https://github.com/thevarsek/nanthai-edge/pull/115). Netlify deploy-preview, header and redirect checks passed; pages-changed is neutral. The preview landing page renders, but sign-in is blocked by its current production Clerk key, which only permits `nanthai.tech`. Auth configuration was not changed. Signed-in feature verification used the localhost DEV app, not the Netlify preview.

Native checks cover live-shaped nullable/future DTO fields, terminal projection/cleanup, Android state ownership and banner rendering/dismissal. The user completed DEV review-account setup. iOS authenticated smoke verification covers OpenRouter connection, chat creation, send/completion and the expected arithmetic reply. Android 1.1.27 (118) password sign-in passed without an email-code challenge after the user enabled the account-only Device Trust bypass; the iOS chat synchronized, and a new Android message completed with the expected reply `6`. The authenticated session persisted after force-stop/relaunch. Fresh Android Debug/release/benchmark assembly also passed. This shared smoke chat is outside the temporary Jev guard and does not prove live Jev behavior. Full native suites and real-device end-to-end sign-in were not run. The unrelated Android image-generation instrumentation fixture was brought up to its existing API signature so device tests compile.

The last iOS build reported two existing compiler warnings in untouched `ChatSendOrchestrationTests.swift:270` and `SettingsImageGenerationDefaultsTests.swift:162`, both actor-isolation references. No iOS lint task is configured. Web's production build retains the existing Vite chunk-size warning; lint itself is clean.

Synthetic DEV memory integration used only disposable records: paraphrase reinforcement (382 ms), atomic supersession with reciprocal history (527 ms), explicit deletion (339 ms), and cleanup of the remaining synthetic old record (502 ms). No synthetic memory remains. Mocked lifecycle tests also cover stale edits/deletions, ownership, manual approval, pins, scopes, replay and deleted-target cleanup. The stalled outcome is covered by human-labelled live API cases and client/backend tests; it was not induced through a complete live autonomous session.

## Evaluation and costs

The user approved all 23 synthetic labels and development thresholds before paid testing. The final rubric matches **46/46 comparisons** across two runs of that same set: discussion 14/14, speakers 6/6, memory 18/18 and moderator 8/8. No false consensus, missed required reply or wrong-target memory action was observed in the final set. Zero final uncertainty fallbacks were returned on that set; deterministic tests exercise those paths separately.

| API/helper micro-benchmark | Jev p50 / p95 | Existing path p50 / p95 | Jev cost / existing cost for the sample |
|---|---|---|---|
| Discussion, 14 | 186.5 / 851 ms | 3,060 / 6,952 ms | $0.000640 / $0.000835 |
| Speakers, 6 | 198.5 / 281 ms | 3,084 / 10,779 ms | $0.000372 / $0.001432 |
| Memory, 18 | 173 / 256 ms | 0 / 2 ms (lexical) | $0.000520 / $0 |
| Moderator selector, 8 | 169.5 / 207 ms | 2,862.5 / 5,326 ms (sentence generation) | $0.000221 / $0.000630 |

These are bounded API/helper comparisons, **not full discussion or memory pipeline timings**. Moderator selection alone does not replace generation when coaching is needed. The lexical memory comparison bypasses admission to compare reconciliation directly: the existing admission rules already prevent hypothetical/transient candidates from becoming facts. Moderator baseline prose was not independently human-scored against category labels.

Composed moderator helper checks used the production selection, configured generation, validation and usage helpers with synthetic context:

| Case | Outcome | Whole helper duration | Selector + generator cost |
|---|---|---|---|
| c1 | Requests concrete throughput evidence | 1,479 ms | $0.001039332 |
| c2 | Clarifies privacy/cost tradeoff | 1,606 ms | $0.000994086 |
| c3 | Tests unsupported conversion assumption | 1,589 ms | $0.001002258 |
| c4 | No intervention; no generation | 245 ms | $0.000028182 |

Total for these four helper calls: **$0.003063858**. The selector adds approximately $0.000028 when generation is needed. There is no matched full-helper baseline proving a moderator end-to-end latency improvement.

The first two rubric rounds exposed missed stalled judgments, false agreement after a new correction, and overly generic evidence selection. The final rubric separates new progress and clarifies intervention priorities. All three rounds and answers are preserved in [the comparison CSV](m60-live-comparisons.csv). This is a small, tuned development corpus, not an independent holdout or proof of broad accuracy.

Confirmed comparison-round spend: **$0.0138478665**, plus a **$0.000013314** endpoint probe. Known DEV test-chat usage totals **$0.0700386147**, including composed tests and Jev charges. Combined confirmed total for that evaluation checkpoint: **$0.0838997952**, below the approved **$10** ceiling. The subsequent two ordinary native arithmetic replies are not included in this subtotal; their usage cost has not been reconciled here. Six ordinary generation/helper usage rows still have unknown costs; they are not counted as free. Jev test decision calls all returned reported costs.

## Release closeout and remaining follow-ups

1. **Memory timing reviewed:** on 2026-09-30 the user accepted additional selector latency subject to the memory timing ceiling. The existing generation cache wait remains 250 ms (`convex/chat/action_memory_helpers.ts`). Jev reconciliation and explicit forgetting run in background post-generation extraction (`enqueueMemoryExtraction`), so their 173 ms median does not consume that allowance or delay the completed reply. The adapter retains its 20-second per-call timeout and existing fallback; that is separate from generation cache waiting. No deadline was raised. Labels/quality targets stay unchanged, costs remain disclosed above, and the release has no flags.
2. **Android lint:** cleanup [PR #116](https://github.com/thevarsek/nanthai-edge/pull/116) merged into M60 before main. Resource/code fixes and approved quantity/haptic changes are verified. Eight punctuation and 27 dependency/platform-policy warnings remain. The user authorized merge after this remainder was reported; zero-warning lint is still unmet. No pending copy/policy recommendations or suppressions were applied. See [cleanup status](m60-android-lint-cleanup.md).
3. **Native delivery:** Android 1.1.27 (118) built and uploaded to Google Play internal testing in [Android Release run 36737722918](https://github.com/thevarsek/nanthai-edge/actions/runs/36737722918). iOS 1.1.36 (178) is committed in all configurations and simulator-verified. Real-device review, public store availability and Xcode Cloud/App Store upload remain unverified here.
4. **Production release:** PR #115 merged to main at `1b7830a1`. The first production run stopped on two stale localization assertions before deploying. The user-approved test-only [PR #117](https://github.com/thevarsek/nanthai-edge/pull/117) corrected the active Android resource checks and merged at `79652245`. All 2,841 backend tests, typecheck, zero-warning backend lint and four smoke-script tests passed locally; [Convex Production run 36740727283](https://github.com/thevarsek/nanthai-edge/actions/runs/36740727283) passed the CI suite, production deployment and live health/model-contract checks. No version or application behavior changed in the correction.
5. **Next work, revised 2026-09-30:** qualify and productionize the parked runtime before the full cloud/Codex M59 release. See the [current roadmap](runtime-roadmap.md). The technical independence of a cloud-only slice is not the chosen delivery plan.

## Reproduce and continue

From this branch, run:

```sh
npx tsx --test convex/tests/*.test.ts
npm run convex:lint
npx tsc --noEmit --project convex/tsconfig.json
cd web
npm run lint
npm run test -- --run
npm run build
npx tsc --noEmit --project tsconfig.app.json
```

Native:

```sh
xcodebuild -project NanthAi-Edge/NanthAi-Edge.xcodeproj -scheme NanthAi-Edge \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES -testLanguage it -testRegion IT \
  -only-testing:NanthAi-EdgeTests/AutonomousSessionProjectionTests \
  -only-testing:NanthAi-EdgeTests/ConvexJobsContractTests test
cd android
./gradlew app:testDebugUnitTest lintDebug assembleDebug
./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.nanthai.edge.features.chat.ChatGeneratedArtifactsAndAutonomousComponentsTest#autonomousToolbarAndEndedBannerCallbacksWork
```

The Android device test needs a booted emulator. For real iOS/Android devices: build this branch against DEV, sign in with the same test account and open the existing **M60 WEB OK** chat (DEV scoping enables Jev only there), then verify normal replies and Collaboration, run an arithmetic discussion with auto-stop on, test a repeated unresolved discussion for the truthful stalled reason, dismiss the ended banner, and test a disposable memory's paraphrase/change/explicit forget. Check manual-confirm memory settings still yield pending facts and leave personal records untouched.

Shared DEV contains M45 data/schema. **Do not deploy this main-based branch directly to shared DEV.** Testing used a three-way patch over the parked runtime branch in `/tmp/nanthai-m60-final-dev-overlay`, with Jev temporarily scoped to the disposable chat. That scoping and all probe code are excluded from this release branch. Keep the compatibility overlay for further DEV work. Production uses the main-based patch only after sign-off.

Rollback is a code revert/redeploy, retaining additive schema/decode compatibility with stored `completed_stalled` records and replay fields. It does not reactivate superseded facts or undo explicit deletion. Provider failure/fallback behavior is tested; a production rollback deployment has not been exercised.
