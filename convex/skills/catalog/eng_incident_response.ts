// convex/skills/catalog/eng_incident_response.ts
// =============================================================================
// System skill: incident-response
// Incident triage, timeline construction, RCA, and postmortem authoring.
// Inspired by Anthropic knowledge-work-plugins/engineering (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const INCIDENT_RESPONSE_SKILL: SystemSkillSeedData = {
  slug: "incident-response",
  name: "Incident Response",
  summary:
    "Guide incident triage, build timelines, perform root cause analysis, and author " +
    "blameless postmortems. Use during or after a production incident to structure the " +
    "response and produce a clear writeup.",
  instructionsRaw: `# Incident Response & Postmortem

Structure the response to production incidents: triage severity, build timelines, identify root causes, and write blameless postmortems. Works during an active incident (real-time triage) or after resolution (retrospective analysis).

## When to Use

- An active incident needs structured triage and communication
- Building a timeline from logs, alerts, and team observations
- Performing root cause analysis after an outage
- Writing a postmortem or incident report
- Reviewing a draft postmortem for completeness
- Creating action items from an incident

## Incident Triage (Active Incident)

### Severity Classification

| Severity | Impact | Examples | Response |
|----------|--------|----------|----------|
| SEV-1 | Complete outage or data loss | Site down, data corruption, security breach | All hands, exec notify, war room |
| SEV-2 | Major feature broken | Payments failing, auth broken, core API errors | On-call + backup, customer comms |
| SEV-3 | Degraded service | Slow responses, partial failures, UI glitches | On-call investigates, monitor |
| SEV-4 | Minor issue | Cosmetic bugs, edge cases, non-blocking errors | Normal priority ticket |

### Triage Checklist
1. **What is broken?** Describe the user-visible symptom
2. **Who is affected?** All users, subset, specific region/plan?
3. **When did it start?** First alert, first customer report, or first log entry
4. **What changed recently?** Deploys, config changes, infrastructure updates
5. **Is there a workaround?** Can users accomplish their goal another way?
6. **What is the blast radius?** Revenue impact, user count, SLA implications

### Communication Template (Active Incident)

**Internal Update:**
> **[SEV-X] [Brief description]**
> **Status:** Investigating / Identified / Mitigating / Resolved
> **Impact:** [Who is affected and how]
> **Started:** [Time in UTC]
> **Current actions:** [What is being done right now]
> **Next update:** [Time of next planned update]

## Timeline Construction

Build a chronological timeline from all available data:

| Time (UTC) | Source | Event |
|-----------|--------|-------|
| 14:02 | Deploy log | v2.3.1 deployed to production |
| 14:05 | Monitoring | Error rate crossed 5% threshold |
| 14:07 | PagerDuty | On-call engineer paged |
| 14:12 | Slack | Engineer acknowledged, began investigation |
| 14:18 | Investigation | Identified database connection pool exhaustion |
| 14:22 | Mitigation | Rolled back to v2.3.0 |
| 14:25 | Monitoring | Error rate returned to baseline |

### Timeline Best Practices
- Use UTC timestamps consistently
- Cite the source for each entry (log, alert, Slack, human observation)
- Include both automated events (alerts, deploys) and human actions (decisions, communications)
- Note the delta between detection and response
- Flag any gaps where the timeline is uncertain

## Root Cause Analysis

### The 5 Whys

Start with the symptom and ask "why" repeatedly until you reach a systemic cause:

1. **Why did the site go down?** → Database connections were exhausted
2. **Why were connections exhausted?** → A new query was holding connections open for 30+ seconds
3. **Why was the query slow?** → It was doing a full table scan on a 50M row table
4. **Why was there no index?** → The migration that added the query didn't include an index
5. **Why wasn't this caught?** → No query performance testing in CI, no connection pool alerts

The root cause is rarely the proximate cause. Keep asking "why" until you reach a process or system gap.

### Contributing Factors

Most incidents have multiple contributing factors. Categorize them:

- **Triggering cause:** The specific change or event that started the incident
- **Enabling conditions:** Pre-existing weaknesses that allowed the trigger to cause an outage
- **Escalating factors:** Things that made the incident worse or longer than it needed to be
- **Detection gaps:** Why alerts or monitoring didn't catch it sooner

## Postmortem Template

### [Incident Title] — Postmortem

**Date:** [Incident date]
**Duration:** [Start time] to [Resolution time] ([Total duration])
**Severity:** [SEV-1/2/3/4]
**Author:** [Name]
**Status:** [Draft / In Review / Final]

---

**Summary**
[2-3 sentences: what happened, who was affected, how it was resolved]

**Impact**
- Users affected: [number or percentage]
- Duration of impact: [time]
- Revenue impact: [estimated, if applicable]
- SLA impact: [was an SLA breached?]
- Support tickets generated: [count]

**Timeline**
[Chronological table as described above]

**Root Cause**
[Clear explanation of the root cause, written so a non-expert can understand]

**Contributing Factors**
1. [Factor with explanation]
2. [Factor with explanation]

**What Went Well**
- [Things that worked: fast detection, good communication, effective rollback]

**What Went Poorly**
- [Things that didn't work: slow detection, unclear runbooks, missing alerts]

**Action Items**
| Priority | Action | Owner | Due Date | Status |
|----------|--------|-------|----------|--------|
| P0 | [Immediate fix to prevent recurrence] | [Name] | [Date] | Open |
| P1 | [Short-term improvement] | [Name] | [Date] | Open |
| P2 | [Longer-term systemic fix] | [Name] | [Date] | Open |

**Lessons Learned**
[Key takeaways that apply beyond this specific incident]

---

## Guidelines

- **Blameless culture.** Focus on systems and processes, not individuals. "The deploy pipeline lacked a performance gate" not "Alice deployed broken code."
- **Be specific.** "Error rate increased from 0.1% to 15% over 3 minutes" not "errors went up a lot."
- **Quantify impact.** Revenue, user count, duration — concrete numbers make the severity real.
- **Action items must be actionable.** Each action item needs an owner, a due date, and a clear definition of done. "Improve monitoring" is not an action item. "Add connection pool utilization alert with threshold at 80%" is.
- **Distinguish root cause from trigger.** The trigger is what happened. The root cause is why the system was vulnerable to that trigger.
- **Include what went well.** Incident response often works better than people think. Acknowledging successes reinforces good practices.
- **Time-box the postmortem.** Aim to complete the writeup within 3-5 business days of resolution while memory is fresh.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "textOnly",
  requiredToolIds: [],
  requiredIntegrationIds: [],
};
