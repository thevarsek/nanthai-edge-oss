// convex/skills/catalog/pm_adr.ts
// =============================================================================
// System skill: adr
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const ADR_SKILL: SystemSkillSeedData = {
  slug: "adr",
  name: "Architecture Decision Record",
  summary:
    "Create an Architecture Decision Record (ADR) following the Nygard format to document " +
    "significant technical decisions, their context, alternatives considered, and consequences.",
  instructionsRaw: `# Architecture Decision Record (ADR)

An ADR documents a significant technical decision along with its context and consequences. ADRs capture the "why" behind architectural choices so future team members understand the reasoning. This skill follows Michael Nygard's lightweight ADR format.

## When to Use

- Making significant technical decisions that affect system architecture
- Choosing between technology options (frameworks, databases, services)
- Establishing patterns that future development should follow
- Documenting the rationale for constraints or non-obvious approaches
- Preserving institutional knowledge about past decisions

## Instructions

When asked to create an ADR, follow these steps:

1. **Assign a Number and Title**
   ADRs are numbered sequentially (ADR-001, ADR-002, etc.) for easy reference. The title should be a short noun phrase describing the decision, like "Use PostgreSQL for order data" or "Adopt React for frontend."

2. **Set the Status**
   New ADRs start as "Proposed." After team review, they become "Accepted," "Deprecated," or "Superseded by ADR-XXX." Status changes should be tracked.

3. **Describe the Context**
   Explain the circumstances that led to this decision. What problem are you solving? What forces are at play (technical constraints, team expertise, timeline, cost)? This section should help a reader who wasn't there understand why this decision was needed.

4. **State the Decision**
   Clearly articulate what you decided. Use active voice: "We will use..." rather than "It was decided..." Be specific about what is and isn't included in the decision.

5. **Document the Consequences**
   List the outcomes of this decision — positive, negative, and neutral. Good ADRs are honest about trade-offs. What becomes easier? What becomes harder? What new constraints or options does this create?

## Output Format

### ADR-[Number]: [Title]

**Date:** [Date]
**Status:** Proposed / Accepted / Deprecated / Superseded by ADR-XXX
**Deciders:** [Who made or will make this decision]

#### Context

What is the issue motivating this decision? What forces are at play?

[2-4 paragraphs explaining the situation, constraints, and forces. Include relevant technical context, team considerations, timeline pressures, and business requirements.]

#### Decision

We will [clear statement of the decision in active voice].

[1-2 paragraphs elaborating on what this means in practice. Be specific about what's included and excluded.]

#### Consequences

**Positive:**
- [What becomes easier or better]
- [What becomes easier or better]

**Negative:**
- [What becomes harder or worse]
- [What becomes harder or worse]

**Neutral:**
- [Notable effects that are neither clearly positive nor negative]

#### Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|------------|------|------|---------|
| [Option A] | ... | ... | ... |
| [Option B] | ... | ... | ... |

#### References
Links to relevant documents, RFCs, or discussions.

## Quality Checklist

- [ ] Title is a short, descriptive noun phrase
- [ ] Status is clearly indicated (Proposed/Accepted/Deprecated/Superseded)
- [ ] Context explains why this decision was needed
- [ ] Decision is stated clearly in active voice
- [ ] Consequences include both positive and negative outcomes
- [ ] Alternatives are documented with reasons for rejection
- [ ] ADR can stand alone without requiring other documents`,
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
