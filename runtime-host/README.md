# NanthAI Runtime Host

The Mac menu-bar app and `nanthai` CLI run Codex/Pi Personas for NanthAI web, iOS and
Android. Convex owns connected conversations, execution, permissions, artifacts
and usage. The host owns native process supervision, transport recovery and local
saved tasks. Package version: 0.4.0; accepted development scope is integrated for
review, with public release tracked in the [milestone index](../milestones/README.md).

## Package layout

| Path | Responsibility |
|---|---|
| `src/` | Supervisor, adapter workers, pairing, transport, saved tasks and CLI |
| `macos-menu/` | Swift menu-bar application and native tests |
| `bin/` | Development CLI entry point |
| `packaging/` | Installer/uninstaller, launcher and entitlements |
| `scripts/` | Package build and explicitly invoked live smoke |
| `tests/` | Protocol, ownership, adapter, storage and recovery tests |
| `dist/` | Ignored build outputs |

## Graphical setup

Install the signed candidate from its DMG into Applications. Select an already
installed Codex or Pi executable and configure the provider normally in that tool.
Use **Connect NanthAI account** to sign in through the browser and return to the
Mac app. Mobile clients supply a one-time pairing code. The host starts after
pairing and adapter readiness; Start/Stop and settings are in the menu bar.

Closing setup keeps the app running; quitting stops its owned host. **Run at login**
is opt-in and preserves existing choices. NanthAI usage includes both engines;
Codex account allowance is separate. **Saved tasks** permits local follow-ups to
received checkpoints and reconciles retained answers/files after reconnection.

See [setup and repair](../docs/runtime/setup.md),
[saved tasks](../docs/runtime/saved-tasks.md) and
[user journeys](../docs/product/local-runtime-journeys.md).

## Foreground CLI

The archive bundles Node 22 and dependencies; Codex/Pi remain user-installed.
Extract the package and run `install.command`. It installs into
`~/Applications/NanthAI Runtime Host` without adding global PATH or login items.
Use the intended native account executable and the controller's deployment:

```sh
export PATH="$HOME/Applications/NanthAI Runtime Host:$PATH"
export NANTHAI_CODEX_COMMAND="/absolute/path/to/codex"
export NANTHAI_CONTROL_PLANE_URL="https://<your-dev-deployment>.convex.site"
nanthai adapters probe codex
nanthai adapters account codex
```

Generate the Advanced pairing command in local-runtime settings and run it in that
shell. Change into the intended working directory, then run `nanthai runtime start`.
Keep the process running. The working directory is not a filesystem sandbox.

## Stop, uninstall and rollback

Use the installed executable's absolute path or the same session PATH:

```sh
nanthai runtime status
nanthai runtime stop --wait
nanthai unpair
```

`uninstall.command` stops/unpairs, then asks you to move the installation folder to
Trash. Unpair removes the local Keychain device credential after host exit; revoke
the machine in settings when retiring it. Native provider auth/history and published
NanthAI results are preserved. Local state is under
`~/Library/Application Support/NanthAI/Runtime Host`; retain it until pending events
and saved results have drained.

For manual upgrade/rollback, stop the host, retain the old installation, install the
replacement and run one copy. The installer refuses an existing destination.
Revoked credentials require pairing again. No automatic-update service is implied.

## Development

Run inside `runtime-host/`:

```sh
npm ci
npm run test:all
npm run build:package -- /absolute/path/to/existing/node22/bin/node
swift test --package-path macos-menu
swift build --package-path macos-menu -c release
```

The builder bundles CLI and workers, copies Node/licenses and emits source/runtime
manifests. It does not download or globally install native tools. For an explicitly
authorized subscription smoke in a temporary read-only workspace:

```sh
node --import tsx scripts/live_codex_smoke.ts --confirm-personal-subscription-use
```

That smoke covers native dynamic context, continuation and frontier rebuild; it
does not pair a device or replace connected qualification. Read
[architecture](../docs/runtime/architecture.md) and
[operations](../docs/runtime/operations.md) before changing lifecycle or packaging.
