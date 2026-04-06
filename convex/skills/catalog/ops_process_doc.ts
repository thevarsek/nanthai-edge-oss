// convex/skills/catalog/ops_process_doc.ts
// =============================================================================
// System skill: process-documentation
// Business process documentation and operational runbooks.
// Inspired by Anthropic knowledge-work-plugins/operations (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const PROCESS_DOC_SKILL: SystemSkillSeedData = {
  slug: "process-documentation",
  name: "Process Documentation",
  summary:
    "Document business processes and create operational runbooks with steps, owners, SLAs, " +
    "decision trees, and escalation paths. Use for SOPs, runbooks, process maps, " +
    "and change management documentation.",
  instructionsRaw: `# Process Documentation & Runbooks

Create clear, actionable process documentation that anyone can follow. Covers SOPs (Standard Operating Procedures), operational runbooks, process maps, and change management docs.

## When to Use

- Documenting a business process from scratch
- Converting tribal knowledge into written procedures
- Creating runbooks for recurring operations (deployments, on-call, incident response)
- Writing change management documentation
- Standardizing processes across teams
- Onboarding documentation for role-specific procedures

## Process Documentation Workflow

### Step 1: Scope the Process
- **Process name:** Clear, descriptive title
- **Purpose:** Why does this process exist? What problem does it solve?
- **Owner:** Who is accountable for this process?
- **Scope:** Where does this process start and end?
- **Frequency:** How often is it executed? (daily, weekly, on-demand, triggered by event)
- **Audience:** Who needs to follow these steps?

### Step 2: Map the Steps

For each step in the process:

| Step | Action | Owner | Tool/System | Input | Output | SLA |
|------|--------|-------|-------------|-------|--------|-----|
| 1 | ... | ... | ... | ... | ... | ... |

Rules for good steps:
- Start each step with a verb (Review, Approve, Send, Update, Verify)
- One action per step — if it has "and," split it
- Include the specific tool or system used
- Note what triggers the step (input) and what it produces (output)
- Specify the time expectation (SLA) where applicable

### Step 3: Document Decision Points

When the process branches, create a decision tree:

\`\`\`
[Decision Question]
├── YES → [Next Step]
└── NO → [Alternative Step]
\`\`\`

For each decision point, document:
- The exact criteria for each path
- Who has authority to make the decision
- What to do if the decision-maker is unavailable
- Default action if criteria are ambiguous

### Step 4: Define Escalation Paths

| Condition | Escalate To | Method | Response SLA |
|-----------|-------------|--------|--------------|
| Step blocked > 2 hours | Team lead | Slack DM | 30 min |
| Customer impact detected | On-call manager | PagerDuty | 15 min |
| Approval needed > $X | Finance director | Email + Slack | 4 hours |
| Process failure | Process owner | Incident channel | 1 hour |

### Step 5: Add Guardrails

- **Pre-conditions:** What must be true before starting?
- **Validation checks:** How do you verify each step completed correctly?
- **Rollback procedures:** If something goes wrong, how do you undo it?
- **Known failure modes:** Common mistakes and how to avoid them

## Runbook Template

### Runbook: [Name]

**Last Updated:** [Date]
**Owner:** [Name/Role]
**Reviewed:** [Date] by [Name]

#### Overview
[1-2 sentences: what this runbook is for and when to use it]

#### Prerequisites
- [ ] Access to [system/tool]
- [ ] Permissions: [specific roles needed]
- [ ] Dependencies: [what must be running/available]

#### Procedure

**Step 1: [Action]**
\`\`\`
[Exact command, URL, or action to take]
\`\`\`
Expected result: [What you should see]
If this fails: [What to do]

**Step 2: [Action]**
...

#### Verification
How to confirm the procedure completed successfully:
- [ ] [Check 1]
- [ ] [Check 2]

#### Rollback
If the procedure needs to be reversed:
1. [Rollback step 1]
2. [Rollback step 2]

#### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| [What you see] | [Why] | [What to do] |

## Change Management Document Template

### Change Request: [Title]

**Requester:** [Name]
**Date:** [Date]
**Priority:** Low / Medium / High / Emergency
**Change Type:** Standard / Normal / Emergency

#### Description
What is changing and why?

#### Impact Analysis
- **Systems affected:** [List]
- **Teams affected:** [List]
- **Customer impact:** None / Low / Medium / High
- **Estimated downtime:** [Duration]

#### Implementation Plan
| Step | Action | Owner | Duration | Rollback |
|------|--------|-------|----------|----------|
| 1 | ... | ... | ... | ... |

#### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ... | Low/Med/High | Low/Med/High | ... |

#### Approval
| Role | Name | Status | Date |
|------|------|--------|------|
| Technical approver | ... | Pending | ... |
| Business approver | ... | Pending | ... |

## Output Format

Choose the appropriate template based on what's being documented:

- **SOP/Process:** Use Step 1-5 workflow above, produce step table + decision trees + escalation paths
- **Runbook:** Use the Runbook Template for operational procedures
- **Change Request:** Use the Change Management Document Template

## Guidelines

- **Write for the new person.** If someone who just joined the team can't follow it, add more detail.
- **Be specific about tools.** "Open the admin dashboard" → "Go to admin.example.com → Settings → Users."
- **Include screenshots or examples** where possible (describe them if you can't include images).
- **Version and date everything.** Stale docs are worse than no docs.
- **Test the runbook.** Have someone who hasn't done the process follow it. Where they get stuck reveals gaps.
- **Keep it DRY.** If multiple processes share steps, extract them into a shared reference doc.`,
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
