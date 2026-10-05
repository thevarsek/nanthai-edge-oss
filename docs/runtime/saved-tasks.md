# Saved tasks and disconnected continuation

Manual tasks can wait for their selected Mac adapter. The existing Workflow waits
before preparing an expiring packet or claiming a native lease. Ordinary
cancellation still owns the task. Scheduled occurrences retain their existing
no-catch-up behavior.

## Continue a prepared task

The Mac saves only context-linked packets it actually received. **Saved tasks**
shows their answers and deliberately published files. The user can add a local
follow-up using Codex or Pi while NanthAI is unavailable. This creates separate
local work; it does not restart the shared run or take over a stale cloud lease.

If internet works, the configured remote provider can still supply inference.
Without internet, execution requires an already configured local model/tool path.
There is no automatic provider fallback, model download or model substitution.
Opening the Mac later cannot reconstruct a checkpoint it never received.

## Storage and interruption

`runtime-host/src/saved_task_store.ts` owns versioned private JSON records and
artifact files. Writes use temporary files, fsync and atomic replacement. A failed
replacement preserves the last committed record. Saved attachment bytes remain
available after the original online fetch handle expires. This bounded store is
not SQLite, a cloud database replica or an unrelated native-history importer.

Task/result identity includes the paired device/deployment and source linkage.
Local results retain their prior-result identity and base-output hash, answer,
files, usage, outcome and synchronization state. Credentials stay outside those
records. Completed native work is retained; tool transcripts are not replayed to
recreate files or side effects.

The active-checkpoint map releases drained turns and clears on shutdown. Question
and permission responses retain their active turn's checkpoint. Durable saved
tasks survive independently of that in-memory map.

## Questions, permissions and Stop

Saved tasks displays the native Codex/Pi choices and permits the supported custom
input. It does not invent recommendations or answer automatically. A private Unix
socket connects the window to the owned continuation process. Responses use CLI
standard input, not process arguments or checkpoint files. Stale request/result
identities cannot answer a newer turn. Reopening the window recovers requests
whose continuation process is still running. Stop uses normal worker cancellation
and retains the local outcome for synchronization.

## Reconnect

The host's single in-flight synchronization owner runs independently of presence
heartbeats and imports terminal results in order. Lost acknowledgements repeat
delivery with the same identity, not model inference or tool effects. One task's
import failure does not prevent independent tasks from synchronizing; its ordered
successors stay local with the actual error.

| Shared state | Import behavior |
|---|---|
| Task unchanged | Import the retained answer and files once into the conversation |
| Task changed or cancelled | Preserve separate local work without overwriting the shared frontier or reopening the cancelled run |

Convex owns reconnect disposition, ownership, imported terminal runs, artifacts
and usage. The Mac does not decide that a stale cloud task is active again.

## Supporting sources

Quote-backed pills identify an earlier message or shared memory actually supplied
to the model. They show its recorded excerpt and optional claim alongside existing
document citations. Validation is advisory: an unsupported citation produces no
pill while the answer remains available. File-change events alone cannot supply a
file quote. Pills do not expose private model reasoning or an entire context view.
Optional capability negotiation preserves older-host compatibility.

See [context assembly](../architecture/context-assembly.md),
[user journeys](../product/local-runtime-journeys.md) and
[acceptance history](../../milestones/M58-offline-context-reconciliation.md).
