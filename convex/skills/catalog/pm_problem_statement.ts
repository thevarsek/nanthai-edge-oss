// convex/skills/catalog/pm_problem_statement.ts
// =============================================================================
// System skill: problem-statement
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const PROBLEM_STATEMENT_SKILL: SystemSkillSeedData = {
  slug: "problem-statement",
  name: "Problem Statement",
  summary:
    "Create a clear problem framing document with user impact, business context, and success " +
    "criteria. Use when starting a new initiative, realigning a project, or communicating priorities to leadership.",
  instructionsRaw: `# Problem Statement

A problem statement frames the problem you're solving, articulates the impact on users and the business, and defines clear success criteria. It ensures alignment on *what* problem to solve before jumping to *how* to solve it.

## When to Use

- Starting a new initiative or project to establish shared understanding
- Realigning a drifted project back to its original intent
- Communicating up to leadership or stakeholders about priorities
- Evaluating whether a proposed solution actually addresses the core problem
- Onboarding new team members to provide context

## Instructions

When asked to create a problem statement, follow these steps:

1. **Identify the User Segment**
   Ask who is experiencing this problem. Get specific about the user persona, role, or segment. Avoid vague descriptions like "users" — instead target "mobile shoppers completing checkout" or "enterprise admins managing 50+ users."

2. **Understand the Pain Points**
   Explore what friction, frustration, or unmet need the user experiences. Ask probing questions to understand the severity and frequency of the problem. Look for evidence from user research, support tickets, or behavioral data.

3. **Establish Business Context**
   Connect the user problem to business impact. How does this problem affect revenue, retention, growth, or strategic goals? Why should the organization invest in solving this now versus later?

4. **Define Success Metrics**
   Identify how you will measure success. What metrics will move if this problem is solved? Establish current baselines and target improvements. Be specific and time-bound.

5. **Surface Constraints and Considerations**
   Note any technical limitations, resource constraints, regulatory requirements, or dependencies that will shape the solution space.

6. **Capture Open Questions**
   Document what you don't know yet. What assumptions need validation? What additional research is needed?

## Output Format

### Problem Statement: [Title]

**Date:** [Date]
**Owner:** [Who owns this problem]
**Status:** Draft / In Review / Approved

#### Problem Summary
2-3 sentences describing the problem clearly.

#### User Segment
Who experiences this problem? How many users are affected?

#### Pain Points
- What friction or frustration exists?
- How severe is it? How frequent?
- What evidence supports this? (data, quotes, tickets)

#### Business Context
- Impact on revenue, retention, growth, or strategic goals
- Why solve this now vs. later?
- Cost of inaction

#### Success Metrics
| Metric | Current Baseline | Target | Timeframe |
|--------|-----------------|--------|-----------|
| ... | ... | ... | ... |

#### Constraints & Considerations
Technical, resource, regulatory, or dependency constraints.

#### Open Questions
Numbered list of unknowns that need validation.

## Quality Checklist

- [ ] Problem is specific to a defined user segment (not "all users")
- [ ] Impact is quantified with data or reasonable estimates
- [ ] Success metrics have baselines and targets
- [ ] Problem describes the "what" without prescribing the "how"
- [ ] Business context explains why this matters now
- [ ] Open questions are captured for follow-up`,
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
