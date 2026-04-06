// convex/skills/catalog/pm_competitive_analysis.ts
// =============================================================================
// System skill: competitive-analysis
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const COMPETITIVE_ANALYSIS_SKILL: SystemSkillSeedData = {
  slug: "competitive-analysis",
  name: "Competitive Analysis",
  summary:
    "Create a structured competitive analysis comparing features, positioning, and strategy " +
    "across competitors. Use when entering a market, planning differentiation, or understanding " +
    "the competitive landscape.",
  instructionsRaw: `# Competitive Analysis

Create structured competitive analyses that help product teams understand where they stand relative to alternatives and identify opportunities for differentiation.

## When to Use

- Before entering a new market or launching a new product
- When planning differentiation strategy for an existing product
- During quarterly or annual strategic planning reviews
- When evaluating build vs. buy decisions
- After losing deals to understand competitive positioning
- When onboarding new team members to the market context

## Instructions

When asked to create a competitive analysis, follow these steps:

1. **Define the Scope**
   Clarify what you're analyzing: a specific feature area, overall product positioning, or pricing strategy. Identify 3-5 key competitors — direct competitors (same solution), indirect competitors (different solution to same problem), and potential disruptors.

2. **Gather Intelligence**
   Research each competitor through available information: websites, pricing pages, reviews, press releases, job postings, and customer testimonials. Note what you can verify vs. what you're inferring.

3. **Build the Feature Matrix**
   Create a comparison grid of key capabilities. Focus on features that matter to your target customers, not exhaustive checklists. Use consistent ratings (e.g., Full, Partial, None, Unknown).

4. **Analyze Positioning**
   Map competitors on a 2x2 positioning matrix using dimensions relevant to your market (e.g., price vs. features, ease of use vs. power, SMB vs. enterprise). Identify white space opportunities.

5. **Assess Strengths and Weaknesses**
   For each competitor, document genuine strengths (what they do better than you) and weaknesses (where they fall short). Avoid dismissing competitors — respect drives better strategy.

6. **Identify Strategic Implications**
   Translate observations into actionable recommendations: where to compete head-on, where to differentiate, what messaging to emphasize, and what gaps represent opportunities.

7. **Note Confidence Levels**
   Mark which conclusions are based on verified data vs. inference. Competitive intelligence has varying reliability — be honest about uncertainty.

## Output Format

### [Product/Market] Competitive Analysis

**Date:** [Date]
**Scope:** [What aspect of competition is being analyzed]
**Analyst:** [Who prepared this]

#### Executive Summary
2-3 sentences on key findings and strategic implications.

#### Competitors Analyzed
| Competitor | Type | Target Market | Key Differentiator |
|-----------|------|--------------|-------------------|
| ... | Direct/Indirect | ... | ... |

#### Feature Comparison Matrix
| Capability | Our Product | Competitor A | Competitor B | Competitor C |
|-----------|------------|-------------|-------------|-------------|
| ... | Full/Partial/None | ... | ... | ... |

#### Positioning Map
Describe the 2x2 matrix with chosen axes and where each player sits.

#### Per-Competitor Assessment
For each competitor:
- **Strengths:** What they do well
- **Weaknesses:** Where they fall short
- **Threat Level:** High/Medium/Low with reasoning

#### Strategic Recommendations
Numbered, prioritized actions based on the analysis.

#### Confidence & Limitations
What's verified vs. inferred. What needs further investigation.

#### Battlecard (Condensed)
When asked for a "battlecard" or "one-pager," produce a condensed version for sales teams:

**[Competitor Name] Battlecard**

**In one sentence:** [What they do and who they serve]

**They win when:** [Scenarios where they're the stronger choice]

**We win when:** [Scenarios where we're the stronger choice]

**Their key talking points:**
- [Claim 1 — and our counter]
- [Claim 2 — and our counter]
- [Claim 3 — and our counter]

**Landmines to set:** [Questions a rep can ask the prospect that highlight competitor weaknesses]
1. "Have you evaluated how [competitor] handles [their weak area]?"
2. "What's your experience with [specific limitation]?"

**Trap questions they'll set:** [Questions the competitor's reps will use against you]
1. "[Question] — How to respond: [response framework]"

**Quick comparison:**
| Area | Us | Them |
|------|-----|------|
| [Key area 1] | [Our position] | [Their position] |
| [Key area 2] | [Our position] | [Their position] |
| [Key area 3] | [Our position] | [Their position] |

## Quality Checklist

- [ ] Scope is clearly defined (what market, segment, use case)
- [ ] 3-5 competitors are analyzed, including direct and indirect
- [ ] Feature comparison focuses on customer-relevant capabilities
- [ ] Positioning map uses meaningful, differentiated dimensions
- [ ] Strengths acknowledge where competitors genuinely excel
- [ ] Recommendations are specific and actionable
- [ ] Sources and confidence levels are documented`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [],
  requiredToolProfiles: [],
  requiredIntegrationIds: [],
};
