// convex/skills/catalog/pm_launch_checklist.ts
// =============================================================================
// System skill: launch-checklist
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const LAUNCH_CHECKLIST_SKILL: SystemSkillSeedData = {
  slug: "launch-checklist",
  name: "Launch Checklist",
  summary:
    "Create a comprehensive pre-launch checklist covering engineering, design, marketing, " +
    "support, legal, and operations readiness. Use before releasing features, products, or " +
    "major updates to ensure nothing is missed.",
  instructionsRaw: `# Launch Checklist

A launch checklist ensures all functions are ready before releasing a feature or product. It coordinates across engineering, QA, design, marketing, support, legal, and operations to prevent launch-day surprises.

## When to Use

- 1-2 weeks before any significant launch
- During launch planning kickoff meetings
- When coordinating cross-functional releases
- Before major version releases or feature rollouts
- After incidents to improve launch processes

## Instructions

When asked to create a launch checklist, follow these steps:

1. **Define Launch Context**
   Document what is launching, when, and who the key stakeholders are. Establish the launch tier (major release, minor feature, experiment) as this affects checklist scope.

2. **Gather Functional Requirements**
   For each function (engineering, QA, marketing, etc.), identify what must be complete, verified, or in place before launch. Distinguish between blockers (must-have) and nice-to-haves.

3. **Assign Owners and Dates**
   Every checklist item needs an owner and a target completion date. Ownership creates accountability; dates enable tracking.

4. **Identify Dependencies and Blockers**
   Flag items that block other work or are blocked by external factors. Surface these early so teams can unblock.

5. **Define Go/No-Go Criteria**
   Establish clear criteria for making the launch decision. What conditions must be met? Who makes the final call?

6. **Document Rollback Plan**
   Every launch should have a rollback strategy. Document how to revert if critical issues emerge post-launch.

7. **Schedule Check-in Cadence**
   Establish when the team will review checklist progress (daily standups, T-2 days review, launch day sync).

## Output Format

### Launch Checklist: [Product/Feature Name]

**Launch Date:** [Date]
**Launch Tier:** Major / Minor / Experiment
**Go/No-Go Decision Owner:** [Name]
**Rollback Owner:** [Name]

---

#### Engineering
- [ ] All code merged and deployed to staging
- [ ] Performance testing completed (load, latency)
- [ ] Database migrations tested and ready
- [ ] Feature flags configured
- [ ] Monitoring and alerting in place
- [ ] [Custom items based on feature]

#### QA
- [ ] Test plan executed, all P0/P1 bugs resolved
- [ ] Regression testing passed
- [ ] Cross-browser/device testing complete
- [ ] Accessibility audit passed
- [ ] [Custom items]

#### Design
- [ ] Final designs reviewed and approved
- [ ] Assets exported and handed off
- [ ] Dark mode / responsive verified
- [ ] [Custom items]

#### Marketing
- [ ] Launch announcement drafted and approved
- [ ] Blog post / changelog prepared
- [ ] Social media posts scheduled
- [ ] Email notification ready
- [ ] [Custom items]

#### Support
- [ ] Help docs / FAQ updated
- [ ] Support team briefed on new feature
- [ ] Known issues documented
- [ ] Escalation path defined
- [ ] [Custom items]

#### Legal / Compliance
- [ ] Privacy review completed
- [ ] Terms of service updated (if needed)
- [ ] GDPR / data handling verified
- [ ] [Custom items]

#### Operations
- [ ] Rollback plan documented and tested
- [ ] On-call schedule confirmed for launch window
- [ ] Capacity verified for expected traffic
- [ ] [Custom items]

---

#### Go/No-Go Criteria
| Criterion | Status | Owner |
|-----------|--------|-------|
| All P0 bugs resolved | ... | ... |
| Staging sign-off complete | ... | ... |
| Marketing assets approved | ... | ... |

#### Rollback Plan
Steps to revert if critical issues emerge post-launch.

## Quality Checklist

- [ ] All functional areas are represented
- [ ] Every item has an owner and target date
- [ ] Blockers are clearly distinguished from nice-to-haves
- [ ] Go/No-Go criteria are specific and measurable
- [ ] Rollback plan is documented and tested
- [ ] Check-in cadence is scheduled`,
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
