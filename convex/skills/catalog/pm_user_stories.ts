// convex/skills/catalog/pm_user_stories.ts
// =============================================================================
// System skill: user-stories
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const USER_STORIES_SKILL: SystemSkillSeedData = {
  slug: "user-stories",
  name: "User Stories",
  summary:
    "Generate INVEST-compliant user stories with clear acceptance criteria from product " +
    "requirements or feature descriptions. Use when breaking down features for sprint planning " +
    "or writing tickets for engineering.",
  instructionsRaw: `# User Stories

User stories are concise descriptions of functionality from the user's perspective. They capture who needs something, what they need, and why — without prescribing how to build it.

## When to Use

- After PRD approval, when breaking down features for implementation
- During sprint planning to create actionable work items
- When writing tickets for engineering teams
- When communicating requirements to stakeholders in accessible terms
- When prioritizing a backlog based on user value

## Instructions

When asked to create user stories, follow these steps:

1. **Understand the Feature Context**
   Review the PRD or feature description. Understand the overall goal, target users, and scope boundaries. User stories should trace back to documented requirements.

2. **Identify User Personas**
   Determine which users interact with this feature. Each story should be written for a specific persona, not generic "users." Different personas may need different stories for the same feature.

3. **Break Down by User Goal**
   Decompose the feature into distinct user goals. Each story should deliver a complete, valuable capability — something the user can actually do when the story is done.

4. **Write Story Statements**
   Use the format: "As a [persona], I want [action] so that [benefit]." The benefit clause is critical — it explains why this matters and helps prioritize.

5. **Define Acceptance Criteria**
   Write specific, testable criteria using Given/When/Then format. Acceptance criteria define "done" — if all criteria pass, the story is complete.

6. **Apply INVEST Criteria**
   Validate each story against INVEST: Independent, Negotiable, Valuable, Estimable, Small, Testable. Revise stories that don't meet these criteria.

7. **Add Context and Notes**
   Include relevant design references, technical considerations, and dependencies. These help implementers understand the full picture.

## Output Format

### User Stories: [Feature Name]

**Source:** [PRD or feature description reference]
**Date:** [Date]

---

#### US-001: [Short Title]

**Story:** As a [persona], I want [action] so that [benefit].

**Acceptance Criteria:**
- **Given** [precondition], **When** [action], **Then** [expected result]
- **Given** [precondition], **When** [action], **Then** [expected result]

**Priority:** Must Have / Should Have / Nice to Have
**Estimate:** S / M / L / XL
**Notes:** Any additional context, design refs, or technical considerations.

---

#### US-002: [Short Title]
...

### INVEST Validation

| Story | Independent | Negotiable | Valuable | Estimable | Small | Testable |
|-------|------------|-----------|---------|----------|-------|---------|
| US-001 | Yes/No | Yes/No | Yes/No | Yes/No | Yes/No | Yes/No |

## Quality Checklist

- [ ] Each story follows "As a... I want... so that..." format
- [ ] Stories are independent (can be built in any order)
- [ ] Acceptance criteria use Given/When/Then format
- [ ] Each criterion is testable (someone can verify pass/fail)
- [ ] Stories are small enough to complete in one sprint
- [ ] No implementation details in the story statement
- [ ] Benefit clause explains why this matters to the user`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["list_documents", "read_document", "find_in_document"],
  requiredToolProfiles: ["docs"],
  requiredIntegrationIds: [],
};
