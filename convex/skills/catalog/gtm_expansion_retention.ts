// convex/skills/catalog/gtm_expansion_retention.ts
// =============================================================================
// System skill: expansion-retention
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const EXPANSION_RETENTION_SKILL: SystemSkillSeedData = {
  slug: "expansion-retention",
  name: "Retention & Expansion",
  summary:
    "Design retention and expansion strategies to reduce churn and increase net revenue retention. " +
    "Covers churn risk signals, upsell triggers, re-engagement campaigns, and customer success automation.",
  instructionsRaw: `# Retention & Expansion Strategy

Design systems to reduce churn, identify expansion opportunities, and improve net revenue retention through proactive customer success and data-driven intervention.

## When to Use

- Churn rate is increasing or above industry benchmarks
- Designing a customer success program from scratch
- Building automated health scoring and intervention workflows
- Planning upsell/cross-sell expansion plays
- Creating win-back campaigns for churned or disengaged customers
- Improving Net Revenue Retention (NRR) toward or above 100%

## Instructions

When asked to design a retention or expansion strategy, follow these steps:

1. **Build a Customer Health Score**
   A health score predicts churn risk before cancellation. Combine leading indicators into a composite score.

   **Signal categories:**
   | Category | Healthy Signals | Risk Signals |
   |----------|----------------|-------------|
   | **Usage** | Increasing DAU/WAU, feature breadth growing | Declining logins, fewer features used, no activity in 14+ days |
   | **Engagement** | Opens emails, attends webinars, reads docs | Unsubscribed from emails, no support contact, ignores outreach |
   | **Support** | Low ticket volume, high CSAT | Escalations increasing, repeated same-issue tickets, low CSAT |
   | **Commercial** | On-time payments, plan upgrades | Late payments, downgrade inquiries, discount requests at renewal |
   | **Adoption** | Using key sticky features, integrations active | Never activated core features, no integrations, single-user account |

   **Scoring approach:**
   - Weight signals by predictive power (usage decline is typically the strongest churn predictor).
   - Segment into zones: Green (healthy), Yellow (at-risk), Red (critical).
   - Update scores weekly minimum. Daily is better for product-led businesses.

2. **Map Churn Risk Interventions**
   For each risk zone, define automated and human interventions:

   **Yellow zone (at-risk):**
   - Trigger: Health score drops below threshold or key usage metric declines 30%+ week-over-week.
   - Automated: In-app nudge to underused feature, email with tips for their use case, NPS survey.
   - Human: CSM review, proactive check-in call, personalized value recap.

   **Red zone (critical):**
   - Trigger: No login in 21+ days, support escalation, cancellation page visit, downgrade request.
   - Automated: Urgent win-back email sequence, executive outreach trigger.
   - Human: Executive sponsor call, custom retention offer, exit interview.

3. **Identify Expansion Triggers**
   Upsell and cross-sell when customers are succeeding, not struggling.

   **Expansion signals:**
   - Approaching usage limits (seats, API calls, storage)
   - Team adding new users organically
   - Using a feature that's limited on current plan but unlimited on next tier
   - Achieving a key milestone (e.g., 100th project, first integration)
   - Champion gets promoted or team grows

   **Expansion plays:**
   | Trigger | Play | Timing |
   |---------|------|--------|
   | Approaching seat limit | Suggest team plan with volume discount | When at 80% of limit |
   | Power feature usage | Highlight premium features they'd benefit from | After 3+ sessions using adjacent feature |
   | Team growth signal | Offer workspace/team onboarding | Within 1 week of new user additions |
   | Milestone achieved | Celebrate + introduce next-level capabilities | At the moment of achievement |

4. **Design Re-Engagement Campaigns**
   For disengaged or churned customers, create multi-touch win-back sequences.

   **Disengaged (still paying, not using):**
   - Day 1: "We noticed you haven't logged in — here's what's new"
   - Day 7: "Quick win: here's how [similar company] uses [product] for [their use case]"
   - Day 14: Personal outreach from CSM with specific suggestions
   - Day 21: "We want to make sure you're getting value — can we help?"

   **Churned (cancelled):**
   - Day 0: Exit survey (keep it to 3 questions max)
   - Day 30: Product update email highlighting improvements related to their exit reason
   - Day 60: Re-engagement offer (extended trial, migration help, concierge onboarding)
   - Day 90: Final personal outreach with a compelling reason to return

5. **Net Revenue Retention (NRR) Framework**
   NRR = (Starting MRR + Expansion - Contraction - Churn) / Starting MRR.

   **Levers to improve NRR:**
   - **Reduce gross churn:** Health scoring, proactive intervention, better onboarding.
   - **Reduce contraction:** Understand downgrade reasons, add value to current plan, offer annual discounts.
   - **Increase expansion:** Usage-based pricing, seat-based growth, feature gating that rewards success.
   - **Target:** B2B SaaS should aim for 110%+ NRR. Below 90% signals a retention crisis.

6. **Automate Customer Success at Scale**
   Not every account gets a dedicated CSM. Build a tech-touch layer:
   - Automated onboarding sequences triggered by signup
   - In-app tooltips and guides triggered by behavior
   - Health-score-based email campaigns (different content for green/yellow/red)
   - Self-serve expansion paths (upgrade prompts at usage limits)
   - Automated QBR reports sent to key accounts

## Output Format

### [Product] Retention & Expansion Strategy

**Current NRR:** [X%]
**Churn rate:** [Monthly/annual]
**Goal:** [Target NRR or churn reduction]

#### Health Score Model
| Signal | Weight | Green Threshold | Yellow | Red |
|--------|--------|----------------|--------|-----|
| ... | ...% | ... | ... | ... |

#### Intervention Matrix
| Risk Zone | Trigger | Automated Action | Human Action | Timeline |
|-----------|---------|-----------------|-------------|----------|
| Yellow | ... | ... | ... | ... |
| Red | ... | ... | ... | ... |

#### Expansion Trigger Map
| Trigger Signal | Expansion Play | Target Segment | Expected Lift |
|---------------|---------------|---------------|--------------|
| ... | ... | ... | ... |

#### Re-Engagement Campaign Templates
Sequence templates for disengaged and churned customer segments.

#### NRR Improvement Roadmap
Prioritized actions with expected impact on NRR.

## Quality Checklist

- [ ] Health score uses leading indicators, not lagging ones
- [ ] Risk signals are specific and measurable, not vague
- [ ] Interventions are defined for each risk zone with clear owners
- [ ] Expansion triggers fire when customers are succeeding, not struggling
- [ ] Re-engagement campaigns are multi-touch with escalating personalization
- [ ] NRR target is stated and levers to reach it are prioritized
- [ ] Automation handles scale while preserving human touch for high-value accounts
- [ ] Exit survey captures actionable churn reasons`,
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
