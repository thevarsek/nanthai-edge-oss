// convex/skills/catalog/prod_brainstorming.ts
// =============================================================================
// System skill: brainstorming
// Original NanthAI skill for structured ideation and brainstorming sessions.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const BRAINSTORMING_SKILL: SystemSkillSeedData = {
  slug: "brainstorming",
  name: "Brainstorming",
  summary:
    "Facilitate structured brainstorming sessions using proven ideation frameworks. " +
    "Covers SCAMPER, Six Thinking Hats, How Might We, Crazy 8s, and constraint-based ideation.",
  instructionsRaw: `# Brainstorming

Facilitate structured ideation sessions that generate diverse, creative ideas and then converge on the most promising ones. Uses proven frameworks to push past obvious answers.

## When to Use

- Stuck on a problem and need fresh perspectives
- Exploring new product directions or features
- Team ideation for campaigns, names, strategies, or solutions
- Product discovery — generating hypotheses to test
- Reframing a problem to find non-obvious approaches
- Any time "we need more ideas before we decide"

## Core Principle: Diverge, Then Converge

Every brainstorming session has two phases. **Never mix them.**

1. **Diverge** — Generate as many ideas as possible. No judgment, no evaluation, no "yes, but." Quantity over quality. Wild ideas welcome. Build on others' ideas.
2. **Converge** — Evaluate, group, prioritize. Apply criteria. Pick winners. Be critical now.

Mixing these phases kills creativity. If someone starts evaluating during divergence, redirect: "We'll evaluate all ideas in the next phase."

## Available Frameworks

### SCAMPER
Systematic prompts applied to an existing product, process, or idea:
- **S**ubstitute — What can you replace? (material, person, process, component)
- **C**ombine — What can you merge? (features, ideas, purposes)
- **A**dapt — What can you borrow from elsewhere? (other industries, nature, history)
- **M**odify — What can you enlarge, shrink, or change? (shape, color, frequency)
- **P**ut to other use — How else could this be used? (new context, new audience)
- **E**liminate — What can you remove? (steps, features, complexity)
- **R**everse — What if you flipped it? (order, roles, assumptions)

Best for: Improving or evolving an existing idea.

### Six Thinking Hats
Examine the problem from six perspectives, one at a time:
- **White Hat** — Facts and data. What do we know? What's missing?
- **Red Hat** — Emotions and intuition. Gut reactions, no justification needed.
- **Black Hat** — Caution. Risks, weaknesses, what could go wrong.
- **Yellow Hat** — Optimism. Benefits, best-case scenarios, opportunities.
- **Green Hat** — Creativity. New ideas, alternatives, provocations.
- **Blue Hat** — Process. Summary, next steps, meta-thinking.

Best for: Balanced evaluation of a complex decision.

### How Might We (HMW)
Reframe problems as opportunity questions:
- Start with a problem statement
- Generate "How might we…?" questions that open up solution space
- Each HMW should be specific enough to be actionable but broad enough to allow multiple solutions
- Then brainstorm solutions for the best HMW questions

Best for: Reframing problems to unlock new solution spaces.

### Crazy 8s (Adapted for Text)
Rapid-fire ideation under time pressure:
- Generate 8 distinct ideas in quick succession
- Each idea is 1-2 sentences max
- No filtering — write whatever comes to mind
- Constraint forces you past the obvious first 3 ideas

Best for: Breaking through creative blocks, getting past safe ideas.

### First Principles
Strip away assumptions and rebuild from fundamentals:
1. State the problem or goal
2. List every assumption you're making
3. Challenge each assumption — which are actually true?
4. Rebuild from only the verified truths
5. What solutions emerge when false assumptions are removed?

Best for: Problems where "the way it's always been done" is the obstacle.

### Constraint Removal / Addition
- **Remove a constraint:** "What if budget were unlimited? What if time weren't a factor? What if there were no technical limitations?"
- **Add a constraint:** "What if we had to launch in 48 hours? What if it had to work offline? What if the user were a child?"

Best for: Shaking loose assumptions you didn't know you had.

## How to Run a Session

1. **Define the challenge.** Write it as a clear question or problem statement.
2. **Choose a framework** (or ask the user which they prefer).
3. **Diverge.** Generate ideas using the framework. Number every idea. Aim for 15-30+ ideas.
4. **Group.** Cluster related ideas into themes. Name each theme.
5. **Converge.** Evaluate against criteria (feasibility, impact, novelty, effort). Pick top 3-5.
6. **Refine.** Develop the top picks into clearer proposals with next steps.

## Output Format

### Divergent Phase
Number all ideas sequentially:
1. [Idea]
2. [Idea]
...

### Grouped Ideas
**Theme A: [Name]**
- Idea 3, Idea 7, Idea 15

**Theme B: [Name]**
- Idea 1, Idea 9, Idea 22

### Top Picks
| Rank | Idea | Why It's Promising | Effort | Impact |
|------|------|--------------------|--------|--------|
| 1 | [Idea] | [Rationale] | Low/Med/High | Low/Med/High |
| 2 | [Idea] | [Rationale] | Low/Med/High | Low/Med/High |
| 3 | [Idea] | [Rationale] | Low/Med/High | Low/Med/High |

### Next Steps
- [What to do with the top ideas — prototype, research, test, discuss]

## Guidelines

- **Quantity first.** In the divergent phase, more is better. Don't stop at 5 "good" ideas.
- **Wild ideas are fuel.** Impractical ideas often spark practical ones.
- **Build on ideas.** "Yes, and…" not "Yes, but…"
- **One idea per bullet.** Don't combine two ideas into one — they can be combined later.
- **No invisible evaluation.** If you're skipping ideas because they seem bad, you're converging too early.

## Quality Checklist

- [ ] Problem statement is clear and specific
- [ ] At least 15 ideas were generated before any evaluation
- [ ] Ideas are diverse — not 15 variations of the same thing
- [ ] No premature criticism during divergent phase
- [ ] Ideas are grouped into meaningful themes
- [ ] Top picks include rationale, not just "this one's best"
- [ ] Next steps are concrete and actionable`,
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
