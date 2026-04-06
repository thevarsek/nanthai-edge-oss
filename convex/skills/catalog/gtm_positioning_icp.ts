// convex/skills/catalog/gtm_positioning_icp.ts
// =============================================================================
// System skill: positioning-icp
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const POSITIONING_ICP_SKILL: SystemSkillSeedData = {
  slug: "positioning-icp",
  name: "Positioning & ICP",
  summary:
    "Define your Ideal Customer Profile and competitive positioning. Covers ICP enrichment " +
    "signals, messaging architecture, competitive differentiation, and market positioning frameworks.",
  instructionsRaw: `# Positioning & ICP

Help the user define a precise Ideal Customer Profile (ICP) and build a competitive positioning framework they can use across sales, marketing, and product.

## When to Use

- Entering a new market or segment
- Repositioning an existing product
- Planning campaigns and need audience clarity
- Aligning sales and marketing on who to target
- Preparing competitive battle cards

## Step 1 — ICP Definition

Build the ICP across three signal layers:

### Firmographic Signals
| Signal | Example |
|--------|---------|
| Industry / vertical | B2B SaaS, fintech, healthcare IT |
| Company size | 50-500 employees, $10M-$100M ARR |
| Geography | North America, DACH region |
| Growth stage | Series B+, post-PMF |
| Tech maturity | Cloud-native, API-first |

### Technographic Signals
| Signal | Example |
|--------|---------|
| Current stack | Uses Salesforce, runs on AWS |
| Tools they lack | No CDP, no attribution platform |
| Integration needs | Must connect to existing CRM |
| Data infrastructure | Snowflake / BigQuery present |

### Behavioral Signals
| Signal | Example |
|--------|---------|
| Buying triggers | Just raised funding, new CRO hired, competitor contract expiring |
| Content engagement | Reads analyst reports, attends SaaStr |
| Pain indicators | Job postings for roles your tool replaces, negative G2 reviews of incumbents |
| Org structure | Has dedicated RevOps or Growth team |

Ask the user for their product/service context, then fill each layer with specific, researched signals — not generic placeholders.

## Step 2 — Competitive Positioning Map

Build a 2×2 positioning matrix:

1. **Choose two axes** that matter most to the ICP (e.g., ease-of-use vs. depth-of-analytics, self-serve vs. enterprise-touch).
2. **Plot 4-6 competitors** plus the user's product on the matrix.
3. **Identify the open quadrant** — this is the positioning opportunity.
4. **State the positioning claim** in one sentence: "We are the only [category] that [unique differentiator] for [ICP]."

When choosing axes, pick dimensions where the user's product genuinely wins. Avoid vanity axes.

## Step 3 — Messaging Architecture

Build a three-layer messaging framework:

### Layer 1: Core Narrative
- **Headline** (8 words max): The promise in the customer's language
- **Subhead** (1 sentence): How you deliver on the promise
- **Proof point**: One specific, quantified result

### Layer 2: Three Pillars
For each of three key capabilities:
- Pillar name (2-3 words)
- Customer benefit (1 sentence, "you" language)
- Supporting proof (stat, case study, or feature)

### Layer 3: Objection Handling
For each of the top 3-5 objections:
- Objection (in the buyer's words)
- Reframe (shift the frame, don't just counter)
- Evidence (proof that neutralizes the concern)

## Output Format

Deliver the complete framework in this order:

1. **ICP Profile** — Table with all three signal layers filled
2. **Positioning Matrix** — 2×2 with competitors plotted and open quadrant identified
3. **Positioning Statement** — One sentence
4. **Messaging Architecture** — All three layers
5. **Quick-Reference Battle Card** — One-page summary of positioning vs. top 2-3 competitors

## Quality Checklist

Before delivering, verify:
- [ ] ICP is specific enough to disqualify prospects (not "everyone")
- [ ] Positioning axes are genuinely differentiating, not table-stakes
- [ ] Messaging uses the customer's language, not internal jargon
- [ ] Proof points are specific and verifiable
- [ ] Objection handling reframes rather than just denies
- [ ] The positioning statement passes the "only we" test — no competitor could say the same thing
- [ ] Output is actionable: a sales rep could use the battle card on a call today`,
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
