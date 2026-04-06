// convex/skills/catalog/pm_experiment_design.ts
// =============================================================================
// System skill: experiment-design
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const EXPERIMENT_DESIGN_SKILL: SystemSkillSeedData = {
  slug: "experiment-design",
  name: "Experiment Design",
  summary:
    "Design rigorous A/B tests and experiments with hypotheses, success metrics, sample sizes, " +
    "and analysis plans. Use when validating product assumptions or measuring the impact of changes.",
  instructionsRaw: `# Experiment Design

Design rigorous experiments that validate product assumptions and measure the impact of changes. A well-designed experiment prevents wasted engineering effort on unvalidated ideas and builds organizational confidence in data-driven decisions.

## When to Use

- Before building a feature to validate the core assumption
- When measuring the impact of a product change (A/B test)
- When stakeholders disagree and data can resolve the debate
- Before investing significant resources in a new direction
- When evaluating multiple solution approaches

## Instructions

When asked to design an experiment, follow these steps:

1. **State the Hypothesis**
   Use the format: "We believe that [change] for [target users] will [expected outcome] because [rationale]." The hypothesis must be falsifiable — it should be possible to prove wrong.

2. **Define the Primary Metric**
   Choose one metric that directly measures the expected outcome. This is the metric that determines success or failure. Avoid vanity metrics — choose metrics that reflect real user value.

3. **Set Secondary and Guardrail Metrics**
   Secondary metrics provide additional context (e.g., engagement depth, feature adoption). Guardrail metrics ensure you're not causing harm elsewhere (e.g., page load time, error rate, other feature usage).

4. **Determine Sample Size and Duration**
   Calculate the sample size needed for statistical significance. Consider: minimum detectable effect, baseline conversion rate, statistical power (typically 80%), significance level (typically 95%). Specify how long the experiment needs to run.

5. **Design the Variants**
   Define control (current experience) and treatment (new experience) precisely. Document what changes between variants. For multi-variant tests, limit to 3-4 variants maximum.

6. **Define Segmentation**
   Specify how users will be assigned to variants: random assignment, percentage split, geographic targeting, cohort-based. Note any exclusion criteria.

7. **Plan the Analysis**
   Define upfront how you'll analyze results: statistical test to use, when to check results (avoid peeking), what constitutes a decision (ship, iterate, kill).

## Output Format

### Experiment Design: [Experiment Name]

**Date:** [Date]
**Owner:** [Name]
**Status:** Proposed / Running / Completed

#### Hypothesis
We believe that [change] for [target users] will [expected outcome] because [rationale].

#### Metrics

| Type | Metric | Baseline | MDE | Target |
|------|--------|----------|-----|--------|
| Primary | ... | ... | ... | ... |
| Secondary | ... | ... | — | ... |
| Guardrail | ... | ... | — | Max acceptable change |

#### Experiment Design

| Parameter | Value |
|-----------|-------|
| Type | A/B / A/B/n / Multivariate |
| Variants | Control: [description], Treatment: [description] |
| Traffic Split | [e.g., 50/50] |
| Sample Size | [per variant] |
| Duration | [minimum days to run] |
| Targeting | [who's included/excluded] |

#### Success Criteria
- **Ship:** Primary metric improves by [X]% with p < 0.05 and no guardrail regressions
- **Iterate:** Directionally positive but not significant — investigate and redesign
- **Kill:** No improvement or guardrail regression

#### Risks and Considerations
What could confound results? Seasonal effects? Other concurrent changes?

## Quality Checklist

- [ ] Hypothesis is falsifiable and specific
- [ ] Primary metric directly measures the expected outcome
- [ ] Guardrail metrics prevent unintended harm
- [ ] Sample size is calculated (not guessed)
- [ ] Duration accounts for weekly cycles (run full weeks)
- [ ] Success/failure criteria are defined before the experiment starts
- [ ] Analysis plan avoids peeking and p-hacking`,
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
