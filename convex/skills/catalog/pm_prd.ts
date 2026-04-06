// convex/skills/catalog/pm_prd.ts
// =============================================================================
// System skill: prd
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const PRD_SKILL: SystemSkillSeedData = {
  slug: "prd",
  name: "Product Requirements Document",
  summary:
    "Create a comprehensive PRD that aligns stakeholders on what to build, why, and how success " +
    "will be measured. Use when specifying features, epics, or product initiatives for engineering handoff.",
  instructionsRaw: `# Product Requirements Document (PRD)

A PRD communicates what to build and why. It bridges the gap between problem understanding and engineering implementation by providing clear requirements, success criteria, and scope boundaries.

## When to Use

- After problem and solution alignment, before engineering work begins
- When specifying features, epics, or product initiatives for handoff
- When multiple teams need to coordinate on a shared deliverable
- When stakeholders need to approve scope before investment
- As reference documentation during development and QA

## Instructions

When asked to create a PRD, follow these steps:

1. **Summarize the Problem**
   Start with a brief recap of the problem being solved. Ensure readers understand *why* this work matters before diving into *what* to build.

2. **Define Goals and Success Metrics**
   Articulate what success looks like. Include specific, measurable metrics with baselines and targets. These metrics should connect directly to the problem being solved.

3. **Outline the Solution**
   Describe the proposed solution at a high level. Focus on user-facing functionality and key capabilities. Include enough detail for stakeholders to evaluate the approach without over-specifying implementation.

4. **Detail Functional Requirements**
   Break down what the system must do. Use user stories or requirement statements. Each requirement should be testable — someone should be able to verify if it's met.

5. **Define Scope Boundaries**
   Explicitly state what's in scope, out of scope, and deferred to future iterations. Clear scope prevents scope creep and sets realistic expectations.

6. **Address Technical Considerations**
   Note any technical constraints, architectural decisions, or integration requirements. Don't design the system, but surface considerations engineering needs to know.

7. **Identify Dependencies and Risks**
   List external dependencies, assumptions, and risks that could impact delivery. Include mitigation strategies where applicable.

8. **Propose Timeline and Milestones**
   Outline key phases and checkpoints. This helps stakeholders understand the delivery plan without committing to specific dates prematurely.

## Output Format

### PRD: [Feature/Initiative Name]

**Date:** [Date]
**Author:** [Name]
**Status:** Draft / In Review / Approved
**Target Release:** [Version or date]

#### 1. Problem Summary
Why this work matters. 2-3 sentences connecting to user pain and business impact.

#### 2. Goals & Success Metrics
| Goal | Metric | Baseline | Target | Timeframe |
|------|--------|----------|--------|-----------|
| ... | ... | ... | ... | ... |

#### 3. Solution Overview
High-level description of what we're building. Focus on user experience.

#### 4. Functional Requirements
Organized by feature area or user flow:

**[Feature Area 1]**
- FR-1: [Requirement] — [Acceptance criteria]
- FR-2: [Requirement] — [Acceptance criteria]

**[Feature Area 2]**
- FR-3: [Requirement] — [Acceptance criteria]

#### 5. Scope
- **In Scope:** What's included in this iteration
- **Out of Scope:** What's explicitly excluded
- **Future Iterations:** What's deferred but planned

#### 6. Technical Considerations
Constraints, architectural decisions, integration requirements.

#### 7. Dependencies & Risks
| Risk/Dependency | Likelihood | Impact | Mitigation |
|----------------|-----------|--------|------------|
| ... | High/Med/Low | High/Med/Low | ... |

#### 8. Timeline & Milestones
| Phase | Milestone | Target Date | Owner |
|-------|-----------|-------------|-------|
| ... | ... | ... | ... |

## Quality Checklist

- [ ] Problem and "why now" are clearly articulated
- [ ] Success metrics are specific and measurable
- [ ] Scope boundaries are explicit (in/out/future)
- [ ] Requirements are testable and unambiguous
- [ ] Technical considerations are surfaced without over-specifying
- [ ] Dependencies and risks are documented with owners
- [ ] Document is readable in under 15 minutes`,
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
