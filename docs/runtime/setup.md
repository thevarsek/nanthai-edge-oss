# Mac setup and connections

## Install and select a runtime

Open the signed candidate DMG, copy **NanthAI Runtime** into Applications and
launch it. The package bundles its own Node runtime and dependencies. Codex and
Pi are installed and authenticated separately by the user. Public availability
is controlled by the backend's `NANTHAI_RUNTIME_HOST_DOWNLOAD_URL`; an unset URL
must not be described as a published download.

Each adapter has **Use default location** and **Choose executable…** controls,
a selected-path caption and its own readiness result. Pi also uses its configured
working folder. Select the executable belonging to the intended provider account.
A failed adapter probe does not prevent another usable selected adapter from
registering. Valid Codex version suffixes are accepted; the minimum core version
is 0.153.4.

Pi discovery uses its normal configured-provider catalogue, including subscription,
API and custom providers. A Pi/OpenRouter route needs Pi's own configured key;
NanthAI does not copy the linked cloud key into Pi. Pi/Ollama needs a running
server and an already installed configured model. NanthAI does not download models.
Catalogue discovery establishes availability, not answer quality for every model.

## Pair the Mac

1. Choose **Connect NanthAI account** in the Mac app.
2. Sign in in the browser and confirm the displayed account and Mac.
3. Choose **Return to NanthAI Runtime**. The app binds the callback to its pending
   state and configured deployment.
4. With pairing and at least one ready adapter, the tray-owned host starts.

On iOS and Android, **Settings → AI connections → Local runtime → Connect a
computer** creates a one-time code to enter into the Mac app. It uses four groups
of four hexadecimal characters; the server stores a hash and claims it atomically.
Browser and code pairing share the existing ten-minute, single-use authority.
Command pairing remains under **Advanced**.

A ready Mac exposes a basic Persona for each supported harness. Settings lists
all Personas currently routed to that Mac, with chat and editing controls. If a
removed pairing still has Personas, a new pairing offers **Reconnect …** for each
one instead of automatically creating replacements. Select the intended Persona;
reconnection preserves its ID, edits and model choice. Machine names are not used
to merge Personas or identify a prior pairing.

**Add basic … Persona** recovers the existing Persona when one is already routed
to that Mac and harness. **Create another … Persona** deliberately creates an
extra. Deleted Personas are never resurrected, and recovery preserves the user's
default and chat references. Existing chats retain their captured routes; use the
chat's existing runtime controls to change a route captured before removal.

## Readiness and daily controls

Pairing, adapter readiness and host connectivity are separate states. An
unperformed probe reads **Not checked**. Ready adapters show a green check; the
connection/menu indicator is green when online and ready, amber during attention
or startup states, and red on host failure. Errors stay beside their adapter.

Closing setup leaves the menu app running. Start/Stop controls own the host;
quitting the app stops its owned host. Keep the Mac awake and connected for
connected execution. **Run at login** is initially off and explicitly selectable;
existing choices are preserved. **Saved tasks** supports deliberate local
continuations described in [saved tasks](saved-tasks.md).

Settings shows canonical **NanthAI usage · all runtimes** with reported tokens,
provider/model groups and available cost estimates. **Codex account limits** is
separate and may include use outside NanthAI. Pi has no universal account-allowance
API. Unreported token components stay unknown rather than appearing as zero.

## Repair and removal

Check the selected executable, native authentication, model availability and
configured deployment before re-pairing. Readiness does not override a chat's
capability requirements: Pi with NanthAI Basic search enabled can be rejected
before dispatch even when Pi is authenticated and online.

Web, iOS and Android active-machine cards expose **Remove**, using the canonical
backend revocation owner and retaining published history. An already revoked
machine can be hidden with **Delete from list**. Re-pairing creates new device authority; it is not automatic
migration of existing Persona routes. Stop and uninstall instructions are in the
[host README](../../runtime-host/README.md). Operational diagnostics and release
qualification are in [operations](operations.md).
