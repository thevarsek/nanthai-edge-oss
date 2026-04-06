// convex/skills/catalog/mktg_campaign_planning.ts
// =============================================================================
// System skill: campaign-planning
// Multi-channel marketing campaign planning.
// Inspired by Anthropic knowledge-work-plugins/marketing (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const CAMPAIGN_PLANNING_SKILL: SystemSkillSeedData = {
  slug: "campaign-planning",
  name: "Campaign Planning",
  summary:
    "Plan multi-channel marketing campaigns with audience targeting, messaging, channel " +
    "strategy, timeline, budget allocation, and measurement framework. Use when designing " +
    "a product launch, seasonal campaign, or demand generation program.",
  instructionsRaw: `# Campaign Planning

Design end-to-end marketing campaigns: define objectives, target audience, messaging, channel strategy, content plan, timeline, budget allocation, and measurement framework. Supports product launches, demand gen, brand awareness, seasonal campaigns, and event marketing.

## When to Use

- Planning a product launch or feature announcement
- Designing a demand generation or lead gen campaign
- Building a seasonal or time-bound promotional campaign
- Creating a brand awareness initiative
- Planning event marketing (webinars, conferences, virtual events)
- Coordinating multi-channel campaigns across paid, owned, and earned media

## Campaign Planning Framework

### 1. Campaign Brief

| Field | Details |
|-------|---------|
| Campaign name | [Memorable internal name] |
| Campaign type | Launch / Demand Gen / Brand / Seasonal / Event |
| Objective | [Specific, measurable goal] |
| Target audience | [Primary and secondary segments] |
| Key message | [One sentence core message] |
| Budget | [Total and per-channel] |
| Timeline | [Start date — End date] |
| Owner | [Campaign lead] |
| Stakeholders | [Teams/people involved] |
| Success metric | [Primary KPI with target number] |

### 2. Audience Definition

**Primary audience:**
- Demographics: [Age, role, industry, company size]
- Psychographics: [Goals, pain points, motivations]
- Behavior: [Where they spend time, how they buy, decision process]
- Current awareness: [Unaware / Problem-aware / Solution-aware / Product-aware]

**Secondary audience:**
- [Same structure as above for secondary segment]

**Audience size estimate:**
- Addressable market: [N]
- Reachable via planned channels: [N]
- Expected engaged audience: [N]

### 3. Messaging Framework

**Core message:** [One sentence that captures the campaign's value proposition]

**Message hierarchy:**
1. **Headline message:** [Attention-grabbing, benefit-led statement]
2. **Supporting message 1:** [Specific benefit + proof point]
3. **Supporting message 2:** [Different angle or audience segment]
4. **Supporting message 3:** [Overcome key objection]

**Messaging by stage:**
| Funnel Stage | Message Focus | Example |
|-------------|--------------|---------|
| Awareness | Problem recognition | "X% of teams waste Y hours on [problem]" |
| Consideration | Solution differentiation | "Unlike [alternative], [product] does [unique thing]" |
| Decision | Risk reduction + urgency | "Join [N] teams who [achieved result]. Start free today." |

**Tone and voice:**
- [Describe the tone: authoritative, friendly, urgent, educational, etc.]
- [Key words to use / avoid]

### 4. Channel Strategy

**Channel mix:**

| Channel | Role | Budget % | Target KPI |
|---------|------|----------|------------|
| Paid search | Capture demand | 25% | CPC < $X, Conv rate > Y% |
| Paid social | Generate awareness | 20% | CPM < $X, Engagement > Y% |
| Email | Nurture leads | 10% | Open rate > X%, CTR > Y% |
| Content/SEO | Organic discovery | 15% | Traffic, rankings, shares |
| Webinar/Events | Deep engagement | 15% | Registrations, attendance |
| PR/Earned | Credibility | 10% | Coverage, backlinks, mentions |
| Partnerships | Extended reach | 5% | Co-marketing leads |

**Channel-specific plans:**

For each channel, define:
- **Objective:** What this channel specifically contributes
- **Tactics:** Specific actions (ad formats, content types, event formats)
- **Creative needs:** What assets are required
- **Targeting:** Audience parameters for this channel
- **Budget:** Spend allocation and pacing
- **Timeline:** When this channel activates and for how long

### 5. Content Plan

| Asset | Channel | Format | Owner | Due Date | Status |
|-------|---------|--------|-------|----------|--------|
| Landing page | Web | HTML | [Name] | [Date] | Not started |
| Launch blog post | Blog/SEO | Long-form | [Name] | [Date] | Not started |
| Email sequence (5) | Email | Copy + design | [Name] | [Date] | Not started |
| Social posts (10) | Social | Image + copy | [Name] | [Date] | Not started |
| Ad creative (3 variants) | Paid | Image/video | [Name] | [Date] | Not started |
| Case study | Sales enablement | PDF/page | [Name] | [Date] | Not started |
| Webinar deck | Events | Slides | [Name] | [Date] | Not started |

### 6. Timeline

**Phase 1: Pre-launch ([Date range])**
- [ ] Finalize messaging and creative brief
- [ ] Produce all content assets
- [ ] Set up tracking and attribution
- [ ] Configure email sequences
- [ ] Brief sales team
- [ ] Seed influencer/partner outreach

**Phase 2: Launch ([Date range])**
- [ ] Publish landing page and blog post
- [ ] Send launch email to subscriber list
- [ ] Activate paid campaigns
- [ ] Post social content
- [ ] Issue press release (if applicable)
- [ ] Host launch webinar

**Phase 3: Sustain ([Date range])**
- [ ] Monitor and optimize paid campaigns
- [ ] Publish supporting content (blog posts, social proof)
- [ ] Run email nurture sequence
- [ ] Retarget engaged non-converters
- [ ] Collect and share early results

**Phase 4: Wrap-up ([Date range])**
- [ ] Pause paid campaigns
- [ ] Compile performance report
- [ ] Conduct retrospective
- [ ] Document learnings for next campaign

### 7. Budget

| Category | Amount | % of Total | Notes |
|----------|--------|-----------|-------|
| Paid media | $X | X% | Search + social + display |
| Content production | $X | X% | Writing, design, video |
| Events | $X | X% | Webinar platform, promotion |
| Tools/Tech | $X | X% | Email, analytics, attribution |
| Contingency | $X | 10% | Buffer for optimization |
| **Total** | **$X** | **100%** | |

### 8. Measurement Framework

**Primary KPI:** [Single most important metric with target]

**Supporting metrics by funnel stage:**

| Stage | Metric | Target | Source |
|-------|--------|--------|--------|
| Awareness | Impressions / Reach | [N] | Ad platforms, analytics |
| Interest | Click-through rate | [X%] | Ad platforms, email |
| Consideration | Leads generated | [N] | CRM, forms |
| Intent | Demo requests / Trial starts | [N] | CRM, product |
| Conversion | Customers / Revenue | [N / $X] | CRM, billing |

**Attribution model:** [First-touch / Last-touch / Multi-touch / Custom]

**Reporting cadence:**
- Daily: Paid media spend and performance
- Weekly: Full funnel metrics, content performance
- Monthly: ROI, CAC, attribution analysis
- End of campaign: Comprehensive report + retrospective

## Campaign Output Format

Deliver the campaign plan as a structured document with all 8 sections above, plus:

**Executive Summary** (at the top):
- Campaign goal in one sentence
- Target audience in one sentence
- Key channels and budget
- Timeline (start → end)
- Primary KPI and target

**Risk Register:**
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [Risk 1] | High/Med/Low | High/Med/Low | [Plan] |

## Guidelines

- **One primary objective.** A campaign that tries to do awareness AND demand gen AND retention at once does none well.
- **Message-market fit first.** Get the messaging right before scaling spend. Test with a small audience.
- **Budget follows strategy.** Don't allocate budget by "what we did last time." Allocate based on where the audience is and what the objective requires.
- **Attribution is imperfect.** Accept it. Use consistent attribution across campaigns so you can compare, even if no model is perfectly accurate.
- **Plan for iteration.** Build in optimization checkpoints. The initial plan is a starting point, not a fixed commitment.
- **Align sales and marketing.** If the campaign generates leads, sales needs to know: what's coming, when, and what the messaging is.
- **Document everything.** Future you (and future campaigns) will thank present you for clear documentation of what was tried, what worked, and what didn't.`,
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
