# Scheduled work

Recurrence uses the native scheduler to start canonical owned execution. Ordered
steps and multi-round progression use Workflow, with independent fan-out owned by
Workpool. Cancellation closes the active attempt's writer fence and uses centralized
run-tree teardown. Scheduled callbacks do not form a second continuation engine.

Scheduled functions have no client authentication context, so the canonical owner
passes the scoped user identity explicitly. Domain tables remain product truth;
Workflow history is not the client's schedule state.

Local schedules use the selected Persona route and its supported capability set.
An offline occurrence fails once without catch-up; the next normal occurrence can
run when ready. Manual tasks waiting for a selected Mac are a separate journey.
See [saved tasks](../runtime/saved-tasks.md) and
[workload authoring](durable-workload-authoring.md).


### Scheduling and conversation tools

| Tool | File | Purpose |
|------|------|---------|
| `create_scheduled_job` | `tools/scheduled_jobs.ts` | Create a recurring AI task with cron expression |
| `list_scheduled_jobs` | `tools/scheduled_jobs.ts` | List user's scheduled jobs |
| `delete_scheduled_job` | `tools/scheduled_jobs.ts` | Delete a scheduled job |
| `create_persona` | `tools/persona.ts` | Create a new persona (checks for duplicates internally) |
| `delete_persona` | `tools/persona.ts` | Delete an existing persona |
| `search_chats` | `tools/search_chats.ts` | Full-text search across user's chat history |
| `spawn_subagents` | `tools/spawn_subagents.ts` | Delegate up to 3 focused child runs and resume when all are terminal |

### Automated Chat Indicators (UX)

- Clock icon + job name subtitle in chat list rows
- "Scheduled" filter in folder filter bar
- Job name in chat header (provenance subtitle)
- NO in-chat message-level labels

---


---
