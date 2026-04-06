// convex/skills/catalog/gtm_cold_outreach.ts
// =============================================================================
// System skill: ai-cold-outreach
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const COLD_OUTREACH_SKILL: SystemSkillSeedData = {
  slug: "ai-cold-outreach",
  name: "Cold Outreach",
  summary:
    "Create high-converting cold email sequences and outbound campaigns. Covers personalization " +
    "frameworks, deliverability best practices, A/B testing, and multi-touch sequence design.",
  instructionsRaw: `# Cold Outreach

Help the user create cold email sequences that get replies. Focus on relevance, brevity, and clear value — not volume.

## When to Use

- Starting an outbound motion from scratch
- Improving reply rates on existing sequences (< 3% is a red flag)
- Scaling cold outreach while maintaining quality
- Writing sequences for a new ICP or persona
- Planning A/B tests on messaging

## Core Framework: The 3-Line Cold Email

Every cold email should follow this structure:

1. **Observation** — Something specific you noticed about the prospect (proves you did research)
2. **Connection** — How that observation connects to a problem you solve
3. **Ask** — A low-friction next step (never "30 minutes on your calendar")

**Example:**
> Saw your team just opened 3 AE roles in EMEA — scaling internationally is exciting but pipeline sourcing across time zones is brutal.
>
> We help [similar company] generate 40% of their EMEA pipeline through async outbound that runs 24/7.
>
> Worth a 15-min look?

Rules:
- Under 80 words total (shorter = higher reply rate)
- One idea per email
- No attachments, no images, no HTML formatting in first touch
- Plain text only — it looks like a real email from a real person

## Personalization Tiers

Not every prospect deserves the same level of personalization. Allocate effort by deal size:

### Tier 1: High-Touch (Enterprise / Strategic)
- Research: 10-15 min per prospect
- Reference: Specific initiative, earnings call quote, LinkedIn post, or recent hire
- Volume: 10-20 per day
- Expected reply rate: 15-25%

### Tier 2: Semi-Personalized (Mid-Market)
- Research: 2-3 min per prospect
- Reference: Industry-specific pain point + company-level signal (funding, hiring, tech stack)
- Volume: 30-50 per day
- Expected reply rate: 5-12%

### Tier 3: Signal-Based (SMB / Volume)
- Research: Automated signals only
- Reference: Role-based pain point + one dynamic variable (company name, industry, size)
- Volume: 100-200 per day
- Expected reply rate: 2-5%

Ask the user which tier matches their deal size and sales motion.

## Multi-Touch Sequence Design

### 5-Email Sequence Template

| Email | Day | Purpose | Tone |
|-------|-----|---------|------|
| 1 | Day 0 | Observation + connection + ask | Curious, relevant |
| 2 | Day 3 | New angle — share a relevant insight or data point | Helpful, generous |
| 3 | Day 7 | Social proof — "Here's what [similar company] achieved" | Credible, specific |
| 4 | Day 12 | Objection preempt — address the likely "no" reason | Empathetic, direct |
| 5 | Day 18 | Breakup — "Closing the loop, not a fit right now?" | Respectful, final |

Rules for the sequence:
- Each email must stand alone (assume they didn't read the previous one)
- Never guilt-trip ("Just following up", "Bumping this to the top")
- Each email introduces a NEW reason to reply
- Subject lines: 3-5 words, lowercase, no punctuation, looks like an internal email
- Reply to the same thread for emails 2-5 (keeps the conversation in one place)

### Subject Line Best Practices
- **Do:** "quick question about [initiative]", "[first name] — [relevant topic]", "idea for [company]"
- **Don't:** "Exclusive offer!", "Don't miss out", anything with ALL CAPS or excessive punctuation
- 3-5 words, no clickbait, no emojis
- A/B test subject lines in batches of 100+ sends before declaring a winner

## Deliverability Fundamentals

Cold email that lands in spam is wasted effort. Cover these basics:

### Domain Setup
- Use a separate sending domain (not your primary domain)
- Set up SPF, DKIM, and DMARC records before sending a single email
- Warm up new domains: start at 5 emails/day, increase by 5 every 2-3 days over 4 weeks
- Never send more than 50 cold emails per mailbox per day

### Content Rules
- No spam trigger words ("free", "guaranteed", "act now", "limited time")
- No tracking pixels or link tracking on first touch
- One link maximum (to your homepage or a relevant resource)
- Plain text, no HTML templates
- Keep unsubscribe easy — include a one-line opt-out

### List Hygiene
- Verify all email addresses before sending (bounce rate must stay below 3%)
- Remove anyone who doesn't engage after the full sequence
- Never re-enroll someone who already completed a sequence within 90 days

## A/B Testing Framework

Test one variable at a time:

| Variable | Sample Size | Duration | What to Measure |
|----------|-------------|----------|----------------|
| Subject line | 100+ per variant | 3-5 days | Open rate |
| Opening line | 100+ per variant | 5-7 days | Reply rate |
| CTA / ask | 100+ per variant | 5-7 days | Positive reply rate |
| Send time | 200+ per variant | 2 weeks | Open rate + reply rate |
| Sequence length | 200+ per variant | Full sequence | Overall reply rate |

Only change the winning variant into your control after statistical significance (not just "Version B looks higher").

## Advanced: Branching Sequences

For more sophisticated outreach, design sequences with conditional branches based on prospect behavior:

### Branch Logic

\`\`\`
Email 1 (Day 0) — Observation + Connection + Ask
├── Positive reply → Exit sequence, route to AE
├── Objection reply → Branch to Objection Handler sequence
├── Opened, no reply → Email 2A (Day 3) — Different angle
│   ├── Opened again → Email 3A (Day 7) — Social proof
│   └── No open → Email 3B (Day 7) — New subject line
├── No open → Email 2B (Day 4) — Resend with new subject
│   ├── Opened → Rejoin main sequence at Email 3
│   └── No open → Email 3C (Day 10) — Final attempt, different channel?
└── Bounced → Remove from list, find alternate contact
\`\`\`

### Objection Handler Templates

When a prospect replies with an objection, have templates ready:

**"We already use [competitor]"**
> Totally get it — [competitor] is solid for [their strength]. Most of our customers actually came from [competitor] because [specific gap you fill]. Would it be useful to see a side-by-side of what's different?

**"Not the right time"**
> Completely understand. When would be a better time to revisit? Happy to send a quick resource in the meantime so you have context when the timing is right.

**"Not interested"**
> Appreciate you letting me know. Mind if I ask — is [problem you solve] not a priority right now, or have you already solved it another way? Just want to make sure I'm reaching the right people.

**"Send me more info"**
> Sure — rather than a generic deck, let me send something specific to [their situation]. Would a [case study / comparison / ROI calculator] be most useful?

### Multi-Channel Sequence

For enterprise prospects, layer in non-email touches:

| Touch | Day | Channel | Action |
|-------|-----|---------|--------|
| 1 | Day 0 | Email | Observation + connection + ask |
| 2 | Day 1 | LinkedIn | Connect request with personalized note |
| 3 | Day 3 | Email | New angle — share insight |
| 4 | Day 6 | LinkedIn | Engage with their content (comment/like) |
| 5 | Day 8 | Email | Social proof — case study |
| 6 | Day 11 | LinkedIn | Direct message with resource |
| 7 | Day 14 | Email | Objection preempt |
| 8 | Day 18 | Email | Breakup |

## Output Format

1. **Sequence Strategy** — Tier selection, target persona, volume plan
2. **Email Templates** — All 5 emails with subject lines, body copy, and personalization placeholders
3. **Personalization Guide** — What to research per prospect and where to insert it
4. **A/B Test Plan** — First 2-3 tests to run with hypothesis, variants, and success criteria
5. **Deliverability Checklist** — Domain setup, warm-up schedule, sending limits

## Quality Checklist

Before delivering, verify:
- [ ] Every email is under 80 words
- [ ] Each email has a clear, single ask
- [ ] Personalization is specific enough that it couldn't apply to any random company
- [ ] No spam trigger words or aggressive formatting
- [ ] Sequence has escalating value, not escalating pressure
- [ ] Subject lines are 3-5 words, lowercase, conversational
- [ ] Deliverability setup is documented
- [ ] No references to specific third-party tools — frameworks are tool-agnostic`,
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
