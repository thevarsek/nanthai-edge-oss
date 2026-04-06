// convex/skills/catalog/gtm_ai_pricing.ts
// =============================================================================
// System skill: ai-pricing
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const AI_PRICING_SKILL: SystemSkillSeedData = {
  slug: "ai-pricing",
  name: "Pricing Strategy",
  summary:
    "Design pricing models for products and services. Covers consumption-based, seat-based, " +
    "usage-based, freemium, and hybrid models with margin analysis and competitive benchmarking.",
  instructionsRaw: `# Pricing Strategy

Help the user design, evaluate, or restructure pricing for their product or service. Focus on practical economics, not theory.

## When to Use

- Launching a new product and need a pricing model
- Repricing an existing product (churn, margin, or competitive pressure)
- Evaluating competitor pricing to find gaps
- Designing tiers, add-ons, or usage-based components
- Modeling free tier economics

## Step 1 — Value Metric Identification

The value metric is what customers pay for. It must pass three tests:

| Test | Question | Good Example | Bad Example |
|------|----------|-------------|-------------|
| Alignment | Does usage correlate with value received? | API calls for a data enrichment tool | Seats for a tool only 2 people use |
| Scalability | Does it grow with the customer's success? | Revenue processed | Flat monthly fee |
| Predictability | Can the buyer estimate their cost? | Messages sent (trackable) | "Compute units" (opaque) |

Ask the user what their product does, then identify 2-3 candidate value metrics. Score each on the three tests.

## Step 2 — Pricing Model Selection

Evaluate each model against the user's context:

### Seat-Based
- **Best for:** Collaboration tools where more users = more value
- **Pros:** Predictable revenue, easy to understand
- **Cons:** Discourages adoption, shelfware risk
- **Watch out:** If only 20% of seats are active, customers will churn

### Usage-Based (Consumption)
- **Best for:** Infrastructure, APIs, data tools
- **Pros:** Low barrier to start, revenue scales with customer success
- **Cons:** Revenue volatility, hard for customers to budget
- **Watch out:** Requires metering infrastructure and transparent dashboards

### Outcome-Based
- **Best for:** Performance marketing, sales tools, lending
- **Pros:** Perfect value alignment, easy ROI story
- **Cons:** Attribution disputes, revenue depends on customer execution
- **Watch out:** Need ironclad measurement and attribution methodology

### Hybrid (Base + Usage)
- **Best for:** Most SaaS products today
- **Pros:** Predictable base + upside from growth, balances buyer/seller risk
- **Cons:** More complex to communicate
- **Structure:** Platform fee (covers base cost) + metered component (scales with value)

Recommend a primary model with rationale. If hybrid, specify the split.

## Step 3 — Tier Design

Design 3-4 tiers using this framework:

| Element | Free / Starter | Growth | Pro / Enterprise |
|---------|---------------|--------|-----------------|
| **Purpose** | Acquisition & activation | Primary revenue driver | Expansion & retention |
| **Value metric limit** | Enough to experience value | Enough for serious use | Unlimited or custom |
| **Features** | Core only | Core + integrations | Full platform + support |
| **Support** | Community / docs | Email, SLA | Dedicated CSM |
| **Price anchor** | $0 or very low | Competitive midpoint | Premium (2-3× Growth) |

### Free Tier Design Rules
- Must deliver real value (not a crippled demo)
- Must have a natural upgrade trigger (not an artificial wall)
- Cost to serve must be < 5% of paid ARPU
- Time-limited trials outperform feature-limited free tiers for complex products

## Step 4 — Competitive Benchmarking

Build a pricing comparison table:

1. List 3-5 direct competitors
2. For each: model type, entry price, mid-market price, enterprise price, value metric
3. Calculate price-per-unit at each tier (normalize to the same value metric)
4. Identify where the user can be 20-30% cheaper OR justify a premium with differentiation

## Step 5 — Unit Economics & Margin Analysis

For the recommended pricing:

| Metric | Formula | Target |
|--------|---------|--------|
| Gross margin | (Revenue − COGS) / Revenue | > 70% for SaaS |
| CAC payback | CAC / (Monthly gross profit × customers) | < 18 months |
| LTV:CAC ratio | (ARPU × Gross margin × Avg lifetime) / CAC | > 3:1 |
| Expansion revenue % | Upgrade + add-on revenue / Total revenue | > 20% |

Flag any metric that falls outside healthy ranges and suggest adjustments.

## Output Format

1. **Value Metric Recommendation** — Chosen metric with scoring rationale
2. **Pricing Model** — Selected model with why it fits
3. **Tier Structure** — Table with tiers, limits, features, and prices
4. **Competitive Benchmark** — Comparison table with normalized pricing
5. **Unit Economics** — Key metrics with projections
6. **Migration Plan** (if repricing) — Grandfather strategy, communication plan, timeline

## Quality Checklist

Before delivering, verify:
- [ ] Value metric passes all three tests (alignment, scalability, predictability)
- [ ] Pricing model matches the product's value delivery pattern
- [ ] Free tier has a clear, natural upgrade trigger
- [ ] Tiers have meaningful differentiation (not just limit bumps)
- [ ] Competitive positioning is based on actual data, not assumptions
- [ ] Unit economics are healthy (gross margin > 70%, LTV:CAC > 3:1)
- [ ] The pricing is simple enough to explain in one sentence per tier`,
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
