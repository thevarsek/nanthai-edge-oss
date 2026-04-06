// convex/skills/catalog/pm_retrospective.ts
// =============================================================================
// System skill: retrospective
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const RETROSPECTIVE_SKILL: SystemSkillSeedData = {
  slug: "retrospective",
  name: "Retrospective",
  summary:
    "Facilitate and document team retrospectives that drive actionable improvements. " +
    "Use after sprints, projects, incidents, or any team effort worth reflecting on.",
  instructionsRaw: `# Retrospective

A retrospective is a structured reflection on a period of work to identify what went well, what didn't, and what to change. Effective retros create actionable improvements rather than just venting sessions. They build team trust and drive continuous improvement.

## When to Use

- After completing a sprint or iteration
- At the end of a project or major initiative
- After an incident or outage
- When team morale or velocity has shifted notably
- Quarterly as a regular practice
- After a launch to capture learnings while fresh

## Instructions

When asked to facilitate or document a retrospective, follow these steps:

1. **Set the Context**
   Define the period under review (sprint dates, project name, incident). Remind participants of key events — what was attempted, what shipped, what happened. Facts first, opinions later.

2. **Gather "What Went Well"**
   Collect wins, successes, and positive practices. Be specific — not "communication was good" but "daily standups caught the API issue before it hit production." Celebrate genuine achievements.

3. **Gather "What Didn't Go Well"**
   Collect frustrations, failures, and friction. Focus on systems and processes, not individuals. Frame as "the process failed" not "person X failed." Look for patterns across multiple items.

4. **Gather "What We Learned"**
   Capture surprising insights, new knowledge, or changed assumptions. These often reveal deeper truths than surface-level wins and losses.

5. **Identify Root Causes**
   For significant issues, ask "why" 2-3 times to get past symptoms to root causes. If "deploys were slow," ask why — was it test suite speed, review bottlenecks, or CI infrastructure?

6. **Generate Action Items**
   Convert insights into specific, actionable improvements. Every action item needs an owner and a target date. Limit to 2-3 actions — teams that try to fix everything fix nothing.

7. **Track Follow-Through**
   Reference action items from the previous retro. Were they completed? Did they help? Accountability makes retros meaningful over time.

## Output Format

### Retrospective: [Sprint/Project/Incident Name]

**Period:** [Start date] — [End date]
**Facilitator:** [Name]
**Participants:** [Names]

#### Context
Brief summary of what was attempted during this period. Key events and milestones.

#### What Went Well
- [Specific positive outcome or practice]
- [Specific positive outcome or practice]
- [Specific positive outcome or practice]

#### What Didn't Go Well
- [Specific issue or frustration] — Root cause: [why this happened]
- [Specific issue or frustration] — Root cause: [why this happened]
- [Specific issue or frustration] — Root cause: [why this happened]

#### What We Learned
- [Insight or changed assumption]
- [Insight or changed assumption]

#### Previous Action Items Review
| Action | Owner | Status | Impact |
|--------|-------|--------|--------|
| [From last retro] | ... | Done/In Progress/Dropped | ... |

#### New Action Items
| # | Action | Owner | Target Date |
|---|--------|-------|-------------|
| 1 | [Specific, actionable improvement] | [Name] | [Date] |
| 2 | [Specific, actionable improvement] | [Name] | [Date] |

#### Themes & Patterns
Any recurring themes across retros or broader observations.

## Quality Checklist

- [ ] Context sets the scene with facts, not opinions
- [ ] "Went well" items are specific and celebratory
- [ ] "Didn't go well" focuses on systems, not blame
- [ ] Root causes are identified (not just symptoms)
- [ ] Action items are specific with owners and dates
- [ ] Limited to 2-3 action items (not a wish list)
- [ ] Previous retro actions are reviewed`,
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
