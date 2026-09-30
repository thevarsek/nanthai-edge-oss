# M45 implementation and personal-Mac handoff — 2026-09-11

**Items 1–4 are implemented; the branch is prepared for the personal-Mac E2E journey. M45 remains open and unreleased.** Local tests and the real adapter smoke do not certify a clean-machine install or a connected multi-client journey.

## Delivered

- Current Persona defaults resolve for each new logical turn; in-flight Workflow execution keeps its captured effective configuration. Persistent chat-route snapshot writers are removed. Explicit route overrides retain priority; bare-model participants remain cloud routes.
- Canonical message IDs survive shared context assembly. Delivery receipts compare ordered content and effective policy, rather than substring matching or timestamps. Compatible reuse injects every undelivered human/peer message once. Removed, edited, reordered or newly excluded context forces a visible same-route rebuild. Images selected by shared assembly retain authorized fetch handles and hashes, including prior context images.
- A completed, fenced terminal stores the real native turn ID and delivered frontier. Failed/cancelled/interrupted or unidentified native turns release reuse. Before a new native turn, bounded `thread/turns/list` must match that frontier; outside advancement rebuilds without importing private native history. This is a preflight check, not an atomic lock against someone writing simultaneously through another Codex client.
- `nanthai_read_context` reports authorized references/omissions. `nanthai_publish_result` publishes bounded text/Markdown/CSV/JSON through existing storage, generated files, operation journal and deterministic shared evidence/memory extraction. The existing client file query and peer assembly read it. Repeated identical content in one job returns the same publication; failed upload never reports success. Structured commit rejection removes its uncommitted blob. Transport ambiguity retains bytes rather than risking deletion of a committed file; process loss between upload and commit can leave an unreferenced blob, without publishing it.
- Explicit web setup works without an OpenRouter key and survives reload. One optional Convex preference records `setup`/`ready`; only a successful fenced local turn marks activation ready and completes local onboarding. Existing cloud onboarding is unchanged. Shared title fallback and memory preparation do not require a successful OpenRouter call to execute the local turn.
- Onboarding now says **Connect your account**, with **Connect OpenRouter** and **Set up local runtime** as peer actions. Setup identifies **OpenAI Codex CLI**, and the first authenticated ready report after explicit pairing automatically provisions a starter Persona and its adapter-default binding. The machine card launches its chat using the existing chat creation path. A stored optional device reference prevents duplicate provisioning and preserves later edits/deletion; initial local onboarding now selects the starter as the default Persona once, while Settings pairing, completed-onboarding replay and subsequent heartbeats preserve default choices. Pro execution entitlement is unchanged. Light/dark background tokens are unchanged. The onboarding UI/provisioning amendment passed 21 focused web tests. The default-selection correction passes the full 2,936-test backend suite and 17 focused web tests covering ordinary chat defaults, Settings display and the existing local model picker. A server-owned one-time preference marker preserves subsequent manual default changes before activation completes. Existing iOS/Android chat creation already consumes the same `defaultPersonaId`; native builds were not run here.
- Host version **0.2.0** packages its own **Node 22.23.2** and bundled dependencies. Existing external Codex **0.153.4** is the tested minimum; newer stable versions are admitted and their actual versions are reported. No global install, automatic provider update or model fallback was added. The README documents selection/path repair, install, foreground ownership, access policy, stop/unpair and rollback.

## Validation

| Check | Evidence |
|---|---|
| Backend lint / TypeScript | Clean, zero lint errors or warnings |
| Full backend test suite | 2,936 passed |
| Runtime Host lint / TypeScript | Clean, zero lint errors or warnings |
| Runtime Host tests under explicit Node 22.23.2 | 102 passed after Ponytail cleanup |
| Web lint / build | Clean lint; production build and development-route exclusion pass; existing Vite chunk-size advisory remains |
| Focused web tests | Latest default-selection correction: 17 passed. Earlier implementation: 29 passed for onboarding, auth/setup guard, pairing/readiness, Persona route/model, public/protected routing |
| Actual Codex 0.153.4 / GPT-6-Astra | Personal-account dynamic context tool, native continuation and stale-frontier rebuild passed |
| Standalone package | Bundled CLI and worker execute using copied Node; actual Codex account/model probe passes; temporary-prefix installer and overwrite refusal checked |
| Shipping dependency audit | Zero production dependency advisories; developer tooling audit remains outside the shipped bundle |

Commands: `npm run convex:lint`, `npm run convex:typecheck`, `node --import tsx --test convex/tests/*.test.ts`; Runtime Host `npm run lint`, `npm run typecheck`, explicit Node 22 `--import tsx --test tests/*.test.ts`; web `npm run lint`, `npm run build`, and focused `vitest run`. `convex codegen --typecheck disable` regenerated bindings using DEV schema analysis; it did not activate a deployment. The live smoke is an explicit opt-in script, not unattended CI.

The full runtime suite covers worker/process ownership, cancellation, permissions, queue/replay, packet integrity, prior images, exact catch-up, native errors, publication failure/retry and uninstall credential ordering. Backend publication tests compose the real registration/journal/shared-assembly owners; activation tests compose real terminalization for completed, failed and cancelled outcomes. No coverage-only tests or threshold changes were added.

## Ponytail branch review and disposition

Review covered the branch against current main, shipping imports/dependencies/routes, and the changed dispatch → worker → ingestion/publication → client paths.

- `runtime-host`: delete SDK transport, SDK normalization/projection and experimental transport selection; use the selected App Server implementation.
- `runtime-host/package.json`: delete unused Codex and MCP SDK packages; `tsx` is development-only and the shipped runtime bundles Zod.
- `convex/runtime_host` and web routing: delete superseded spike endpoints, observer and their callers/tests; retain historical evidence documents.
- Packet preparation: delete source-only resume helper and text-based identity guesses; reuse canonical metadata and the shared assembler.
- Worker options: delete the unused Git-check flag; App Server did not consume it.

The follow-up Ponytail cleanup removes the unused readiness waiter, per-PID descriptor sampler and token-total helper, and replaces the single-candidate transport loop with a direct lookup. Capability errors are preserved by a focused regression; all 102 runtime tests, lint, typecheck and package build pass.

These findings are resolved. Remaining focused review: **Lean already. Ship to the branch; run personal-Mac acceptance before release.** No parallel orchestration engine, new artifact database, auto-installer or future-harness scaffolding was introduced. Historical snapshot schema remains decode/cleanup-only; its data removal belongs to M54.9 after a deployment reference audit, not this work-laptop change. Existing oversized shared owners receive narrow changes; new receipt, activation and publication concerns have separate small owners.

## Personal Mac: remaining release proof

Use the archive and [package README](https://github.com/thevarsek/nanthai-edge/blob/f05b40e4fec7bdd2f70d5c9839648f623b441812/runtime-host/README.md). Deploy this branch to an explicitly authorized DEV environment and serve its matching web build before pairing. Do not test the new host against an older backend and count failures as package evidence.

1. Install in a fresh user-owned location without Node/npm on PATH. Check executable/account repair, pair, close/reopen setup, and start the foreground host from a disposable working directory. Verify pairing/signed-out presence alone creates no Persona, then signed-in ready presence creates one automatically. With no OpenRouter key, verify Settings shows the generated Persona as the default, create an ordinary new chat, and complete its first turn; verify activation only then becomes ready. Reconnect and confirm there is still one starter Persona; edits and intentional deletion must not be undone. Change the default manually and verify reconnects preserve it; pairing another Mac from Settings must also preserve that choice.
2. Use two existing chats. Change that Persona's prompt/model defaults; verify the next new turn changes while an already running/replayed turn remains stable. Test a deleted Persona and a revoked machine.
3. In a mixed room, run cloud → Codex → cloud with skipped human/peer turns. Reconnect for a second session. Switch branch/context policy, then advance the native thread through Codex itself. Verify visible rebuild and no private native history ingestion.
4. Send a current and prior image; verify correct content. Publish a small CSV via `nanthai_publish_result`; open it from a second signed-in client and ask a peer to use it. Interrupt/retry publication and verify one canonical file/evidence record and truthful failure.
5. Run two local Personas. Exercise web approval/input, cancellation before dispatch, during streaming and with native children; restart/disconnect the host and verify fenced late events and process cleanup. Run a bounded crash/churn session, recording actual failures.
6. Inspect the current iOS/Android build's DTO decoding, file access and advertised local-run controls/handoff. Stop, unpair, revoke, uninstall and restore the prior package. Confirm canonical results survive and no owned host process remains.

Record artifact checksum, commit, macOS version, controller versions and outcomes in the release certificate. Clean-machine Gatekeeper, native app validation, connected DEV journey and crash/churn evidence were not obtained on this work laptop. Broader native setup/tray, new harnesses and the 24-hour mixed soak remain with M53/M54.

The web page currently has no hosted package-download button or installation-guide link; installation is developer-assisted through the package README. M54.2 owns that distribution/setup handoff, and M54.3 explicitly owns web/iOS/Android controller parity. Automatic Codex Persona provisioning is delivered early in M45 and must be reused by those native flows rather than implemented again.

## Workspace footprint

Work uses the isolated `nanthai-edge-m45` checkout on `codex/m45-contract-spike`. Owner-approved main reconciliation includes `68e23215a7fdc3a58f5c56a8408073bb4fa69166`; original checkout changes are preserved. Existing dependencies and an already cached Node 22 were reused. No authentication files/tokens were read into logs; safe account identity was inspected with prior authorization. Real Codex calls used temporary read-only workspaces and left only ordinary native session history.

No global tools, login items, pairing credentials or persistent Runtime Host were installed here. Generated package/build files are ignored; temporary installer copies and test processes are cleaned up. Commit/push affects only the existing M45 branch, not main or a running deployment.
