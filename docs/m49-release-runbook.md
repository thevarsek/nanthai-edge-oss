# M49 Remote MCP Release Runbook

This runbook is the final release path for self-service Remote MCP servers. It does not authorize a production deploy or an App Store/Play submission by itself.

## Release candidate scope

- Convex remains the canonical product API and M46/M47 remains the execution control plane.
- Web, iOS, and Android expose the same connection, item-decision, invocation, pending-input, and Task contracts.
- Only compatible HTTPS, stateless MCP `2026-07-28` endpoints are admitted.
- Pro entitlement and Allow/Disabled decisions are enforced at dispatch.
- Existing first-class connectors and released-client compatibility functions are unchanged.
- There is no rollout flag.

## Physical-device acceptance

Run the following on one current iOS device and one current Android device against Convex dev:

1. Add a fresh public/no-auth server and confirm unsupported or legacy endpoints receive the compatibility explanation.
2. Add the authenticated Cloudflare server, complete OAuth in the system browser, and return to the correct connection.
3. Rename the server, refresh its catalog, allow one tool, one prompt, and one resource, and keep a second item disabled.
4. Enable the server in chat and confirm the friendly tool name and server name appear in the trace.
5. Attach the prompt and resource to a message; confirm attribution and returned content are readable rather than a raw MCP envelope.
6. Complete accept, decline, and safe HTTPS URL elicitation. Confirm credential-like form fields are refused.
7. Start, refresh, update, cancel, and complete a Task. Force-close and reopen during one pending operation to prove recovery.
8. Disable the item and server, then confirm new dispatch is blocked immediately. Disconnect and confirm the connection disappears.
9. Add the server as a Persona override and Skill target, then confirm both resolve through the same connection.

Record the endpoint, auth mode, app commit, OS/app versions, and stable MCP error code for any failure. Never record tokens, codes, response bodies, arguments, or elicitation answers.

## Automated release gates

From the repository root:

```bash
npm run convex:lint
npx tsc --noEmit --project convex/tsconfig.json
npx tsx --test convex/tests/*.test.ts

cd web
npm run lint
npx tsc --noEmit --project tsconfig.app.json
npm test -- --run
npm run build

cd ../android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug

cd ..
xcodebuild -project "NanthAi-Edge/NanthAi-Edge.xcodeproj" \
  -scheme "NanthAi-Edge" \
  -destination "generic/platform=iOS Simulator" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build
```

Run the authenticated MCP Playwright project with a disposable Pro account and controlled endpoint. Do not treat environment-dependent skips as passes.

## Production order

Production work requires explicit authorization.

1. Confirm required MCP egress, OAuth/CIMD, callback, encryption-keyring, Clerk, and Pro-entitlement environment values without printing secrets.
2. Deploy Convex production and run `health:check` plus non-secret schema/data-shape audits.
3. Deploy Netlify production, smoke `/features`, `/features/remote-mcp`, Settings management, the OAuth callback, and the hardened egress path.
4. Repeat one public and one authenticated live invocation through production.
5. Build and submit iOS and Android from the exact tagged commit. Apply platform version bumps only on the release-to-main commit and use user-approved version numbers.
6. Release both clients together after backend/web health is stable. Existing clients remain compatible because all new fields are optional and existing public functions remain.

## Rollback and monitoring

- Stop new Remote MCP dispatch by disabling the product entitlement path only if an incident requires it; do not add a permanent rollout system during release.
- Revert the web/native release without removing backend fields or public functions used by the new clients.
- Do not remove `k1`, enable legacy credential reads, enable automatic rotation, or remove `scheduledJobs/mutations:upsertApiKey` as part of M49 rollback.
- Monitor counts and stable categories for discovery rejection, egress denial, OAuth failure/refresh, disabled dispatch, `outcome_unknown`, input wait, Task recovery, cancellation, and teardown.
- Escalate credential exposure, cross-user isolation, private-network egress, or duplicated unknown writes as release-blocking incidents.
