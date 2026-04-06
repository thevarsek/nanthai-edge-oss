// convex/skills/catalog/pm_sprint_planning.ts
// =============================================================================
// System skill: sprint-planning
// Sprint planning: story breakdown, estimation, capacity allocation.
// Inspired by Anthropic knowledge-work-plugins/product-management (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const SPRINT_PLANNING_SKILL: SystemSkillSeedData = {
  slug: "sprint-planning",
  name: "Sprint Planning",
  summary:
    "Break features into sprint-sized stories, estimate effort, allocate team capacity, " +
    "and produce a sprint plan. Use when planning an upcoming sprint or decomposing a " +
    "feature into implementable work items.",
  instructionsRaw: `# Sprint Planning

Break features and epics into sprint-sized stories, estimate effort, allocate team capacity, and produce actionable sprint plans. Supports Scrum, Kanban, and hybrid workflows.

## When to Use

- Planning an upcoming sprint or iteration
- Breaking an epic or feature into user stories
- Estimating effort for a set of work items
- Allocating team capacity across competing priorities
- Reviewing a proposed sprint plan for feasibility
- Calculating velocity and projecting delivery timelines

## Sprint Planning Workflow

### 1. Define Sprint Parameters

| Parameter | Value |
|-----------|-------|
| Sprint number | [N] |
| Duration | [1/2/3 weeks] |
| Start date | [Date] |
| End date | [Date] |
| Team size | [N people] |
| Available capacity | [Story points or person-days] |
| Sprint goal | [One sentence describing the sprint's primary objective] |

### 2. Calculate Team Capacity

\`\`\`
Capacity per person = Sprint days × Focus factor
Total capacity = Sum of individual capacities

Focus factor adjustments:
- Full-time IC: 0.8 (20% meetings/overhead)
- Tech lead (50% IC): 0.4
- On-call rotation: 0.6
- PTO days: subtract from sprint days
\`\`\`

**Example:**
| Team Member | Role | Sprint Days | Focus Factor | Available Days |
|------------|------|-------------|-------------|----------------|
| Alice | IC Engineer | 10 | 0.8 | 8 |
| Bob | IC Engineer | 8 (2 PTO) | 0.8 | 6.4 |
| Carol | Tech Lead | 10 | 0.4 | 4 |
| Dave | IC Engineer | 10 | 0.6 (on-call) | 6 |
| **Total** | | | | **24.4 days** |

### 3. Story Breakdown

Break features into stories that are:
- **Independent** — Can be developed and tested without other stories
- **Negotiable** — Details can be discussed, not locked in stone
- **Valuable** — Delivers user or business value (even if small)
- **Estimable** — Team can size it with reasonable confidence
- **Small** — Completable within the sprint (ideally 1-3 days)
- **Testable** — Has clear acceptance criteria

#### Story Template

**As a** [user type]
**I want to** [action]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] [Criterion 1 — specific, testable condition]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

**Technical Notes:**
- [Implementation considerations, dependencies, risks]

**Estimate:** [Points or days]

### 4. Estimation

#### Story Points (Fibonacci)
| Points | Meaning | Example |
|--------|---------|---------|
| 1 | Trivial, < 2 hours | Fix a typo, update a constant |
| 2 | Small, half a day | Add a form field, write a simple query |
| 3 | Medium, 1-2 days | New API endpoint with tests, UI component |
| 5 | Large, 2-3 days | Feature with multiple components, integration work |
| 8 | Very large, ~1 week | Complex feature, significant refactoring |
| 13 | Epic-sized — should be split | Too big for one sprint, decompose further |

#### Estimation Tips
- Compare to past stories the team has completed
- If the team can't agree, the story may need more refinement
- Include testing, code review, and deployment in estimates
- Add a buffer story (bug fixes, tech debt) worth ~15% of capacity
- 8+ point stories should be split — they carry too much uncertainty

### 5. Prioritize and Commit

**Priority framework:**

| Priority | Criteria | Sprint action |
|----------|----------|---------------|
| P0 — Must have | Blocks the sprint goal or a release | Commit first |
| P1 — Should have | Important for the sprint goal | Commit if capacity allows |
| P2 — Nice to have | Valuable but not urgent | Stretch goal |
| P3 — Backlog | Can wait for a future sprint | Don't commit |

**Commitment rule:** Total committed points ≤ team velocity (rolling 3-sprint average). Add 1-2 stretch items at P2 in case the team moves faster than expected.

### 6. Identify Dependencies and Risks

| Story | Dependency | Risk | Mitigation |
|-------|-----------|------|------------|
| [Story A] | Needs API from Team X | High — not yet delivered | Start with mock, parallel track |
| [Story B] | Design review needed | Medium — designer on PTO | Pre-review this week |
| [Story C] | New library | Low — well-documented | Spike first day |

## Sprint Plan Output

### Sprint [N] Plan — [Date Range]

**Sprint Goal:** [One-sentence goal]

**Team Capacity:** [X] story points / [Y] person-days

**Committed Work:**

| # | Story | Points | Assignee | Priority | Dependencies |
|---|-------|--------|----------|----------|-------------|
| 1 | [Story title] | 5 | Alice | P0 | None |
| 2 | [Story title] | 3 | Bob | P0 | Story 1 |
| 3 | [Story title] | 3 | Carol | P1 | Design approved |
| 4 | [Story title] | 2 | Dave | P1 | None |
| 5 | [Bug fix buffer] | 3 | Rotating | P1 | None |
| **Total committed** | | **16** | | | |

**Stretch Goals:**
| # | Story | Points | Notes |
|---|-------|--------|-------|
| 6 | [Story title] | 2 | If Stories 1-2 finish early |

**Risks:**
1. [Risk with mitigation plan]
2. [Risk with mitigation plan]

**Definition of Done:**
- [ ] Code reviewed and merged
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Deployed to staging
- [ ] Product owner accepted
- [ ] Documentation updated (if applicable)

## Velocity Tracking

| Sprint | Committed | Completed | Velocity | Notes |
|--------|-----------|-----------|----------|-------|
| N-3 | 18 | 16 | 16 | Holiday week |
| N-2 | 20 | 19 | 19 | |
| N-1 | 22 | 21 | 21 | |
| **Average** | | | **18.7** | |

## Guidelines

- **One sprint goal.** If you can't describe the sprint's purpose in one sentence, it's unfocused.
- **Don't over-commit.** It's better to finish everything and pull in stretch items than to carry over incomplete work.
- **Split big stories.** Anything over 5 points should be examined for splitting opportunities.
- **Include buffer.** 10-15% of capacity for unplanned work (bugs, production issues, support).
- **Track velocity honestly.** Don't inflate points to look productive. Velocity is a planning tool, not a performance metric.
- **Dependencies are risks.** Every cross-team dependency is a potential blocker. Identify them early and have a mitigation plan.
- **Acceptance criteria are non-negotiable.** If the criteria aren't clear before sprint start, the story isn't ready.`,
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
