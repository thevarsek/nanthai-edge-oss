# Runtime Host operations

## Build and package

The host package owns its Node supervisor, Codex/Pi workers and bundled dependencies.
The native app lives under `runtime-host/macos-menu/`. Run from `runtime-host/`:

```sh
npm ci
npm run test:all
npm run build:package -- /absolute/path/to/node-v22.23.4-darwin-arm64/bin/node
```

Bundle the official macOS Node 22.23.4 or a newer 22.x, verified against the
release's `SHASUMS256.txt`. The builder refuses older 22.x binaries because they
lack the October 2026 Node.js security fixes (CVE-2026-111497 Brotli decoding,
CVE-2026-105482 DNS NUL truncation and TLS hostname checks); the floor is
`MINIMUM_NODE_22` in `scripts/build-package.mjs`. A rebuilt package is the only
remedy for an installed host, which keeps running the Node it shipped with.

The package builder writes the archive and source/runtime manifest to ignored
`dist/` by default. An optional second argument after the Node path selects a fresh
output directory. It does not install Node or Codex globally and refuses existing
output directories, preserving prior candidates. `script/build_and_run.sh` always
bundles current host source in a temporary directory before assembling the Mac app;
it may reuse the existing bundled Node binary, but never the old application bundle.
The launcher adds bundled Node as a PATH fallback for native tools that use a Node
shebang, including Pi launched from Finder or a login item. Existing PATH tools
keep precedence; no global Node installation is required for this launch path.

The Mac Swift package has debug/release build and test paths:

```sh
swift test --package-path macos-menu
swift build --package-path macos-menu -c release
```

Signed distribution must verify nested signatures, hardened runtime, notarization,
stapling and Gatekeeper on the actual candidate. An unsigned CLI archive and a
signed graphical installer are different delivery artifacts. Keep artifact identity
and qualification scope in the owning milestone, not a new dated documentation file.

## Status and recovery

Use `nanthai runtime status`, `nanthai runtime stop --wait` and the Mac's readiness
view to distinguish pairing, adapter, connectivity and worker failures. Inspect the
ordinary startup error before resetting credentials. A registration-schema mismatch
can leave a correctly paired host offline; HTTP, mutation and database validators
must agree on optional capabilities.
After an expired heartbeat lease, the same process renews its presence session in
place; this reconnect does not require restarting the host or creating a second row.

Only one installed tray/host owner should run. For manual upgrade/rollback, stop it,
retain the old installation, install the replacement and start one copy. Preserve
local spool/saved work until pending events drain. Runtime 0.4.4 stops automatic
restarts after the control plane rejects a device
credential with `401 UNAUTHORIZED`, removes only the rejected local pairing and
shows a reconnect message. Temporary network failures retain pairing and restart
with backoff. Revoked credentials require pairing again. Older installed hosts
can keep retrying until their owner quits or updates the Mac app. Convex keeps
rejecting those heartbeats with HTTP 401, but treats the denial as an expected
result rather than a failed mutation; it cannot remotely stop an old Mac process.
See [the host README](../../runtime-host/README.md) for uninstall.

## Lifecycle qualification

Qualification covers actual installed startup, native input/permissions, long
output, queue pressure, cancellation, crash cleanup and same-chat continuation.
Sleep/wake and reboot/login require actual lifecycle observations; relaunching a
process is not reboot proof. Keep user observation distinct from system counters.

A continuous resource/schedule soak has fixed limits and an identified artifact.
A failed or interrupted clock contributes no elapsed credit to a fresh run. A later
candidate does not inherit a claim that it personally passed the earlier soak.
The completed accepted DEV history is in
[runtime productization](../../milestones/M54-runtime-host-productization.md).

## Reconciliation and cleanup

Compare reported runtime observations against canonical usage exactly once,
including children and cancelled work. Match the account/Mac monthly cache and its
connected rebuild. Verify published artifact ownership, download bytes and hashes.
Unknown components/cost remain unknown; estimates are separate from subscriptions.

Drain owned work before retiring QA configuration. Check settled canonical teardown,
not only a deletion request's immediate response. Remove only the identified QA
schedules, devices, Personas and temporary grants. Preserve published history and
private receipts. Restore the intended personal configuration; never restore a
revoked credential simply because an older test record names it.

A DEV certificate is not production enablement. Public download publication,
production deployment and main-branch integration retain their explicit release
scope. No soak, inference run or lifecycle test is launched by reading this chapter.

## Public installer publication

Build from the reviewed source with a Developer ID Application identity and
production web/control-plane configuration. Notarize the DMG using the existing
Keychain profile, staple it, and validate the actual downloaded bytes with
Gatekeeper and SHA-256. Signing credentials stay in Keychain; they are never
committed or exported. Mac GUI and TypeScript Runtime Host source are included
in the source-available export; generated builds, DMGs and credentials are excluded.

The reusable helper is `runtime-host/scripts/release-macos.mjs`. Configure
`NANTHAI_CODESIGN_IDENTITY` and `NANTHAI_NOTARY_PROFILE` in the operator's shell
or ignored `runtime-host/.env.release.local`. Keep the actual identity, profile
name and deployment URLs in that local file; never put passwords or private keys
in it. The helper does not load shell files automatically.

Build a release app from a clean, reviewed checkout using
`script/build_and_run.sh --build-only` with `NANTHAI_SWIFT_CONFIGURATION=release`
and the intended production web/control-plane URLs. Then run:

```sh
npm --prefix runtime-host run release:macos -- "/absolute/path/to/NanthAI Runtime.app"
```

The helper checks package/app versions and HTTPS configuration, signs the app
and bundled Node, notarizes and staples the DMG, and verifies it with Gatekeeper.
Outputs and the receipt stay in ignored `runtime-host/dist/`.
Add `--publish` only for an authorized production publication, with
`NANTHAI_CONVEX_PRODUCTION_URL` set locally to the intended cloud deployment.
Set `NANTHAI_RUNTIME_WEB_URL` locally too; publication checks that the app uses
that website and the same control-plane deployment as the upload target.
Publication verifies a fresh download before updating the backend download URL.
The website environment update and Netlify rebuild below remain a separate step.
Run this on the signing Mac in a normal Terminal with Keychain access.

Upload the verified DMG to production Convex file storage with the internal,
operator-only `runtime_host/installer_storage:generateInstallerUploadUrl`
(`npx convex run --prod`, then POST the DMG with
`Content-Type: application/x-apple-diskimage`). Resolve the returned storage ID to
its public URL with `runtime_host/installer_storage:getInstallerUrl` and use it as both
`NANTHAI_RUNTIME_HOST_DOWNLOAD_URL` in Convex and
`VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL` in the Netlify site build environment.
The public `/local-runtime` page and feature detail expose Download for Mac;
authenticated Settings uses the same URL through its existing shared query.
Download is public, while pairing/use retains the Pro gate.

The application backend must expose the reviewed runtime contracts before the
new application frontend is published. Main integration triggers the production,
Android and public-source workflows; monitor those runs and the Netlify deploy
until they finish. Preserve older signed installer candidates for manual rollback
unless they are withdrawn for a security fix; retire a superseded hosted DMG with
`runtime_host/installer_storage:deleteInstaller` once the new URL is live.
