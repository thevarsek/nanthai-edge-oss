# M60 Android lint cleanup

Work branch: `codex/m60-android-lint-cleanup`, based on M60 commit `31aac3f2`; merge target: `codex/m60-jev-decisions`. The original inventory contains 787 warnings and 9 hints across 61 files. Production release still awaits sign-off.

## Changes

- Remove 530 unused string names from all seven shipped locale files, an unused vector and unreferenced backup XML files. Android source and test references were checked before deletion; no dynamic resource lookup uses these names.
- Reuse the identical Anthracite/Gryphe provider icon and move adaptive icons out of the redundant API-26 qualifier (minimum SDK is 28).
- Use installed AndroidX helpers, primitive Compose state, layout-phase animated offsets, observable configuration locales, and receiver-preserving Modifier extensions. Modifier arguments precede other optional arguments; callers keep their named arguments.
- Retain the existing API-33 speech-recognition boundary with an explicit annotation and remove redundant older-API checks. Preserve notification and preference behavior.
- Apply user-approved quantity labels to files, partial image results, extra artifacts, slides and scheduled minutes. Locale-specific quantity forms are tested on device.
- Apply the approved confirmation/rejection haptic fallbacks on Android 9–10; Android 11+ retains CONFIRM/REJECT.
- Prepare Android 1.1.27 (118) and iOS 1.1.36 (178), as explicitly requested. All iOS build configurations are synchronized.

Resource lint exceptions preserve exact cron syntax, MCP protocol dates and font-certificate bytes; typography changes would corrupt those values. Nounless progress ratios, connection counts and a step identifier are not natural-language quantities. The Spanish vision label is retained as a false-positive spelling notice. No dependency, target-SDK, ABI or backup-policy exceptions have been applied: those decisions are awaiting the user.

Existing oversized owners receive mechanical changes only; no new state owner or unrelated concern is added. Splitting those owners during this cleanup would broaden its risk and scope.

## Verification and remaining gates

- Android Debug build and all 883 JVM tests passed.
- Pixel 10 / Android 16: 47 of 48 selected instrumentation tests passed, including the three new file-selection/quantity tests. The remaining system-Back case failed with Espresso window-focus errors. The emulator subsequently displayed a System UI ANR and ran out of installation space; after dismissing the system dialog and trimming OS caches, the unchanged test passed in isolation. All 48 selected cases have passing results across the initial run and retry; this is not a claim that the initial suite was clean. No test assertion or product code was changed to hide the failure.
- Android Debug, release and benchmark assembly passed again after the review account setup (`assembleDebug assembleRelease assembleBenchmark`, 7m 58s). The first updated lint run crashed in IntelliJ's `AsyncExecutionService`; a fresh `./android/gradlew --project-dir android lintDebug --no-daemon --max-workers=1` run completed with **0 errors and 35 warnings**. Eight are ellipsis notices and 27 are dependency/platform-policy notices. Exact rules, files, lines and messages are in [the remaining inventory](m60-android-lint-remaining.csv). All genuine code/resource findings outside those pending decisions are cleared.
- iPhone 17 Pro / iOS 26.5: build/launch passed, built metadata verified at 1.1.36 (178), and eight focused tests passed in the required Italian locale.
- The user completed the review account's DEV setup. Authenticated iOS smoke testing verified OpenRouter connection, chat creation, send/completion and the expected arithmetic reply (`4`). This new chat is outside the temporary Jev test-chat guard, so it proves the native generation path, not a live Jev decision. Credentials are excluded from source and reports.

- Authenticated Android DEV smoke passed on Pixel 10 / Android 16 with installed version 1.1.27 (118). Password sign-in reached the chat list without an email-code challenge after the user enabled the account-only Device Trust bypass. The existing iOS chat and its reply loaded; sending `add 3 and 3` completed with `6`, restored the idle composer and exposed completed-response actions. Sign-in persisted after force-stop/relaunch, and the synchronized chat preview showed the new reply. The crash buffer contains no NanthAI crash. Screenshot evidence (`m60-android-review-chat.png`) is retained locally with the test record; no credentials are committed.
- The first installation attempt hit emulator storage exhaustion. Rebooting cleared stuck package-manager state and reinstall succeeded without wiping the AVD. Rapid ADB text injection dropped characters; paced input was verified before submission. This smoke does not establish fast-typing behavior on real hardware.

The final lint gate is not waived. Remaining dependency/platform-policy recommendations and eight ellipsis notices await explicit user decisions under AGENTS.md before being applied.
