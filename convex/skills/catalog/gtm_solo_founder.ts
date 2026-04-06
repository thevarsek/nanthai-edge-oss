// convex/skills/catalog/gtm_solo_founder.ts
// =============================================================================
// System skill: solo-founder-gtm
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const SOLO_FOUNDER_GTM_SKILL: SystemSkillSeedData = {
  slug: "solo-founder-gtm",
  name: "Solo Founder GTM",
  summary:
    "Go-to-market playbook for solo founders and small teams. Covers lean tool stacks, " +
    "AI-augmented workflows, revenue stage playbooks, and prioritization for resource-constrained launches.",
  instructionsRaw: `# Solo Founder GTM Playbook

Go-to-market strategy designed for solo founders and teams of 1-3. Every recommendation is filtered through the constraint of limited time, money, and headcount.

## When to Use

- Bootstrapping a product with no dedicated marketing or sales team
- Deciding what GTM activities to prioritize with limited hours
- Choosing tools that won't break a pre-revenue budget
- Figuring out when and who to hire as your first GTM person
- Planning the transition from founder-led sales to a repeatable process

## Instructions

When asked to create a GTM plan for a solo founder or small team, follow these steps:

1. **Identify the Revenue Stage**
   Strategy changes dramatically by stage. Start by identifying where the founder is:

   **$0 – $1K MRR (Validation)**
   - Goal: Find 10 people who will pay. Nothing else matters.
   - Channels: Direct outreach, communities you're already in, Twitter/X building in public.
   - Activities: 50% talking to potential customers, 30% building, 20% sharing what you learn.
   - Avoid: Paid ads, SEO, complex funnels, anything that doesn't involve direct customer conversation.
   - Key metric: Number of conversations with potential customers per week.

   **$1K – $10K MRR (Traction)**
   - Goal: Find a repeatable acquisition channel.
   - Channels: Double down on whatever got you to $1K. Add one more channel to test.
   - Activities: 40% selling/marketing, 40% building, 20% operations.
   - Start: Basic landing page optimization, email capture, simple drip sequence.
   - Avoid: Hiring, multiple channels at once, enterprise sales.
   - Key metric: Customer acquisition cost and channel-specific conversion rates.

   **$10K – $50K MRR (Growth)**
   - Goal: Build a system that generates leads without you doing everything manually.
   - Channels: 2-3 proven channels running consistently. Start content/SEO for long-term.
   - Activities: 30% selling, 30% building, 20% marketing systems, 20% operations.
   - Start: Automations, content engine, referral program, considering first hire.
   - Key metric: MRR growth rate and time spent on manual vs. automated GTM.

   **$50K+ MRR (Scale)**
   - Goal: Remove yourself as the bottleneck.
   - Hire your first GTM person (see section 5).
   - Build playbooks so others can execute your proven channels.
   - Shift to strategy, positioning, and partnerships.
   - Key metric: Revenue per team member and founder hours on GTM.

2. **Lean Tool Stack by Budget**
   Choose tools that fit your budget tier. Prefer tools with generous free tiers.

   **Free / Under $50/mo:**
   - Website: Static site generator or simple landing page builder
   - Email: Any provider with a free tier up to 1,000 subscribers
   - Analytics: Privacy-friendly analytics (free tier) + built-in platform analytics
   - CRM: Spreadsheet or free-tier CRM
   - Social: Native scheduling tools on each platform
   - Support: Shared inbox or email aliases

   **$50 – $200/mo:**
   - Add: Dedicated email marketing with automation, basic SEO research tool, form/survey builder
   - Upgrade: CRM with pipeline tracking, analytics with conversion funnels

   **$200 – $500/mo:**
   - Add: Live chat or chatbot, landing page A/B testing, affiliate/referral tracking
   - Upgrade: Full marketing automation, advanced analytics

   **Principle:** One tool per job. No overlapping tools. Migrate up only when the free tier limits actually block you, not before.

3. **AI as Force Multiplier**
   Solo founders should aggressively delegate these GTM tasks to AI:

   | Task | AI Leverage | Human Required For |
   |------|------------|-------------------|
   | First draft of blog posts, emails, ad copy | High — 80% done by AI | Voice, nuance, final edit |
   | Keyword research and content briefs | High — faster than manual research | Strategic prioritization |
   | Competitor analysis | High — synthesize public info quickly | Strategic interpretation |
   | Social media post generation | Medium — needs brand voice tuning | Engagement and replies |
   | Customer interview synthesis | Medium — good at pattern extraction | Conducting the interviews |
   | Pricing page copy | Medium — strong with frameworks | Pricing strategy decisions |
   | Strategic positioning | Low — lacks market intuition | This is founder's job |
   | Customer relationships | None — never automate this | Always personal |

   **Rule of thumb:** Use AI for first drafts and research. Keep strategy decisions and relationship building human.

4. **Time Allocation Framework**
   Solo founders have ~50 productive hours per week. Allocate deliberately:

   **The 40/40/20 starting split:**
   - 40% Building product (20 hrs)
   - 40% Selling and marketing (20 hrs)
   - 20% Operations and admin (10 hrs)

   **Adjust by stage:**
   - Pre-revenue: Shift to 30/50/20 (more selling, less building)
   - Post-product-market-fit: Shift to 20/50/30 (more systems, less building)

   **Weekly GTM time blocks (within the 40% selling/marketing):**
   - Monday: Content creation (blog, social, email)
   - Tuesday–Wednesday: Direct outreach and sales conversations
   - Thursday: Community engagement and partnership outreach
   - Friday: Analytics review, experiment planning, admin

   **Anti-patterns to avoid:**
   - "I'll market once the product is perfect" — it never will be.
   - Spending more than 1 hour/day on social media without a clear goal.
   - Context-switching between building and selling within the same 2-hour block.

5. **When and Who to Hire First**
   Hire your first GTM person when:
   - You have a proven, repeatable channel that's bottlenecked on your time.
   - MRR can sustain the hire for 6+ months without revenue growth.
   - You can write a clear playbook for what they'll do in week 1.

   **Who to hire by situation:**
   - If inbound is working: Content marketer or growth generalist.
   - If outbound is working: SDR or junior AE with outbound experience.
   - If product-led: Growth engineer or product marketer.
   - If nothing is working yet: Don't hire. Fix the channel first.

   **Red flags — don't hire if:**
   - You're hoping the hire will "figure out" GTM for you.
   - You can't articulate your ICP, value prop, and primary channel clearly.
   - You're hiring to avoid doing sales yourself.

## Output Format

### [Product] Solo Founder GTM Plan

**Current stage:** [$0-1K / $1K-10K / $10K-50K / $50K+]
**Monthly budget for tools:** [$X]
**Hours available for GTM per week:** [X hrs]

#### Stage-Specific Action Plan
Top 5 priorities for this revenue stage, in order.

#### Recommended Tool Stack
| Category | Tool | Cost | Why |
|----------|------|------|-----|
| ... | ... | ... | ... |

#### Weekly Time Allocation
| Day | GTM Focus | Hours | Activities |
|-----|-----------|-------|-----------|
| ... | ... | ... | ... |

#### AI Delegation Plan
Tasks to delegate to AI, with the human checkpoint for each.

#### 90-Day Milestones
| Month | Target | Key Activities | Success Metric |
|-------|--------|---------------|---------------|
| 1 | ... | ... | ... |
| 2 | ... | ... | ... |
| 3 | ... | ... | ... |

#### First Hire Readiness Assessment
When you'll be ready and what role to hire.

## Quality Checklist

- [ ] Revenue stage is correctly identified and plan matches that stage
- [ ] Recommendations are filtered for solo-founder constraints (time, budget, headcount)
- [ ] Tool stack fits the stated budget with no overlapping tools
- [ ] Time allocation is specific with weekly blocks, not vague percentages
- [ ] AI delegation is realistic about what AI can and cannot do well
- [ ] First-hire guidance includes clear readiness criteria
- [ ] Plan avoids common solo-founder anti-patterns (premature optimization, avoiding sales)
- [ ] 90-day milestones are measurable and achievable by one person`,
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
