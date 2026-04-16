// convex/skills/catalog/scheduled_jobs.ts
// =============================================================================
// System skill: scheduled-jobs
// Manages NanthAI's built-in scheduled/recurring jobs — daily summaries,
// weekly reports, periodic reminders, and other automated AI tasks.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const SCHEDULED_JOBS_SKILL: SystemSkillSeedData = {
  slug: "scheduled-jobs",
  name: "Scheduled Jobs",
  summary:
    "Create, list, update, or delete recurring AI jobs — daily summaries, weekly reports, " +
    "periodic reminders, and other automated tasks that run on a schedule.",
  instructionsRaw: `# Scheduled Jobs

Manage NanthAI's recurring automated tasks. Each job runs a prompt on a schedule, creates a new chat with the results, and sends the user a push notification when complete.

## Available Tools

- **create_scheduled_job** — Create a new recurring job
- **list_scheduled_jobs** — List all jobs with status and next run time
- **update_scheduled_job** — Edit an existing job (name, prompt, schedule, pause/resume)
- **delete_scheduled_job** — Remove a job and its run history

## When to Use

- "Remind me every morning to …"
- "Set up a daily summary of …"
- "Create a weekly report that …"
- "Run this every Friday at 9am"
- "What scheduled jobs do I have?"
- "Pause / delete / change the schedule of …"
- Any request for recurring, periodic, or automated AI tasks

## Key Concepts

**Recurrence types:**
- \`daily\` — runs at a specific hour:minute UTC every day
- \`weekly\` — runs on a specific day and time UTC
- \`interval\` — runs every N minutes (minimum 15)
- \`cron\` — 5-field cron expression for advanced schedules
- \`manual\` — only runs when the user taps "Run Now"

**Multi-step jobs:** A job can have up to 5 sequential steps, each with its own prompt, model, and settings. Use this for pipelines like "search → summarize → email".

**Timezone:** All times are in UTC. Convert the user's local time to UTC before creating the job. If the user says "8am" without specifying a timezone, ask which timezone they mean.

## Workflow

### Creating a Job
1. Clarify what the user wants automated and how often
2. Convert their schedule to UTC
3. Write a detailed, self-contained prompt — the job runs without user context
4. If the job needs integrations (Gmail, calendar, etc.), set \`enabledIntegrations\`
5. Call \`create_scheduled_job\`
6. Confirm: job name, schedule in user's timezone, what it will do

### Listing Jobs
1. Call \`list_scheduled_jobs\`
2. Present: name, schedule, status (active/paused), next run, last run result
3. Offer to modify or delete if the user asks

### Updating a Job
1. List jobs if the user refers to one by name
2. Call \`update_scheduled_job\` with the changes
3. Confirm what changed

### Deleting a Job
1. Confirm which job (by name or ID)
2. Call \`delete_scheduled_job\`
3. Confirm deletion

## Prompt Writing Tips

The job's prompt runs without conversational context. Make it explicit:
- State exactly what tools/integrations to use
- Specify the output format
- Include any filtering criteria (e.g., "only unread emails from the last 24 hours")
- Mention what to do if there's nothing to report

**Good:** "Search Gmail for unread emails from the last 24 hours. Summarize each email in 1-2 sentences, grouped by sender. If there are no new emails, say 'No new emails.'"

**Bad:** "Summarize my emails"`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "create_scheduled_job",
    "list_scheduled_jobs",
    "update_scheduled_job",
    "delete_scheduled_job",
  ],
  requiredToolProfiles: ["scheduledJobs"],
  requiredIntegrationIds: [],
};
