// convex/skills/catalog/pm_persona.ts
// =============================================================================
// System skill: persona
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const PERSONA_SKILL: SystemSkillSeedData = {
  slug: "persona",
  name: "User Persona",
  summary:
    "Generate evidence-based product or marketing personas with demographics, goals, pain points, " +
    "and behavioral patterns. Use when defining target users, aligning teams on audience, or " +
    "informing product and marketing strategy.",
  instructionsRaw: `# User Persona

A persona is a semi-fictional representation of a target user based on research and data. Good personas go beyond demographics to capture goals, frustrations, behavioral patterns, and decision-making processes. They help teams make user-centered decisions by providing a concrete reference point.

## When to Use

- When defining target users for a new product or feature
- To align cross-functional teams on who they're building for
- When making prioritization decisions that require user empathy
- To inform marketing messaging and positioning
- When onboarding new team members to the user base
- During design sessions to ground discussions in user reality

## Instructions

When asked to create a persona, follow these steps:

1. **Define the Persona Type**
   Clarify whether this is a product persona (for product decisions), marketing persona (for messaging and targeting), or buyer persona (for sales). Each has different emphasis.

2. **Establish Demographics and Context**
   Define role, industry, company size, experience level, and relevant context. Keep demographics minimal — focus on what actually influences behavior and decisions.

3. **Articulate Goals and Motivations**
   What is this person trying to achieve? Include both functional goals (tasks to complete) and emotional goals (how they want to feel). Goals drive behavior.

4. **Document Pain Points and Frustrations**
   What obstacles prevent them from achieving their goals? What current solutions fall short? Pain points reveal opportunities.

5. **Describe Behavioral Patterns**
   How do they currently solve the problem? What tools do they use? How do they make decisions? What information sources do they trust?

6. **Capture a Day-in-the-Life Scenario**
   Write a brief narrative showing how the persona encounters the problem in their daily work. This makes the persona feel real and builds empathy.

7. **Note Confidence Levels**
   Mark which aspects of the persona are based on research data vs. assumptions. This transparency helps teams know where to invest in further research.

## Output Format

### Persona: [Name] — [Title/Role]

**Type:** Product / Marketing / Buyer
**Confidence:** High / Medium / Low (based on evidence quality)

#### Demographics
| Attribute | Value |
|-----------|-------|
| Role | ... |
| Industry | ... |
| Company Size | ... |
| Experience | ... |
| Tech Savviness | ... |

#### Quote
> "[A representative quote that captures their mindset]"

#### Goals & Motivations
1. **[Primary goal]** — Why it matters to them
2. **[Secondary goal]** — Why it matters to them
3. **[Emotional goal]** — How they want to feel

#### Pain Points & Frustrations
1. **[Pain point]** — Impact on their work
2. **[Pain point]** — Impact on their work
3. **[Pain point]** — Impact on their work

#### Behavioral Patterns
- **Current solutions:** What they use today
- **Decision process:** How they evaluate and choose tools
- **Information sources:** Where they go for advice
- **Adoption style:** Early adopter / mainstream / late majority

#### Day-in-the-Life Scenario
A brief narrative (3-5 sentences) showing how they encounter the problem in context.

#### What Would Win Them Over
Key factors that would make them choose your solution over alternatives.

#### Confidence Assessment
| Aspect | Based On | Confidence |
|--------|----------|------------|
| Demographics | [Research/Assumption] | High/Med/Low |
| Goals | [Research/Assumption] | High/Med/Low |
| Pain points | [Research/Assumption] | High/Med/Low |
| Behaviors | [Research/Assumption] | High/Med/Low |

## Quality Checklist

- [ ] Persona is based on evidence, not stereotypes
- [ ] Goals include both functional and emotional dimensions
- [ ] Pain points are specific and actionable
- [ ] Behavioral patterns describe actual behavior, not assumptions
- [ ] Day-in-the-life scenario feels realistic and builds empathy
- [ ] Confidence levels are honest about what's researched vs. assumed`,
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
