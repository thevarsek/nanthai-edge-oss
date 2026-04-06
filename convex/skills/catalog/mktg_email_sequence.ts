// convex/skills/catalog/mktg_email_sequence.ts
// =============================================================================
// System skill: email-sequence
// Multi-step email nurture/onboarding sequence design.
// Inspired by Anthropic knowledge-work-plugins/marketing (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const EMAIL_SEQUENCE_SKILL: SystemSkillSeedData = {
  slug: "email-sequence",
  name: "Email Sequence",
  summary:
    "Design multi-step email sequences for onboarding, nurture, re-engagement, and " +
    "sales follow-up. Use when building drip campaigns or automated email flows with " +
    "timing, subject lines, and content for each step.",
  instructionsRaw: `# Email Sequence Design

Design multi-step automated email sequences: onboarding, nurture, re-engagement, sales follow-up, and lifecycle campaigns. Produce complete sequences with timing, subject lines, content, and branching logic.

## When to Use

- Building an onboarding email sequence for new users/customers
- Designing a nurture campaign for leads
- Creating a re-engagement sequence for inactive users
- Planning sales follow-up email cadences
- Building lifecycle email flows (trial → paid, free → pro)
- Designing abandoned cart or incomplete action sequences

## Sequence Types

### Onboarding (New User)
**Goal:** Guide new users to their first success (activation)
**Typical length:** 5-8 emails over 14-21 days
**Key metrics:** Open rate, click rate, activation rate, time-to-value

### Lead Nurture
**Goal:** Move prospects from awareness to consideration to decision
**Typical length:** 6-10 emails over 30-60 days
**Key metrics:** Open rate, click rate, reply rate, conversion to demo/trial

### Re-engagement
**Goal:** Win back inactive users before they churn
**Typical length:** 3-5 emails over 14-21 days
**Key metrics:** Re-activation rate, open rate, unsubscribe rate

### Sales Follow-up
**Goal:** Follow up after a meeting, demo, or proposal
**Typical length:** 4-6 touches over 14-28 days
**Key metrics:** Reply rate, meeting booked rate, deal progression

## Sequence Design Framework

### Step 1: Define the Sequence

| Parameter | Value |
|-----------|-------|
| Sequence name | [Name] |
| Type | Onboarding / Nurture / Re-engagement / Sales |
| Entry trigger | [What puts someone into this sequence] |
| Exit conditions | [What removes someone — conversion, unsubscribe, reply] |
| Audience | [Who receives this: persona, segment, lifecycle stage] |
| Primary goal | [What action you want the recipient to take] |
| Success metric | [How you'll measure if the sequence works] |

### Step 2: Map the Journey

Before writing emails, map the emotional and informational journey:

1. **Awareness** — Recipient knows they have a problem
2. **Education** — Recipient understands possible solutions
3. **Consideration** — Recipient evaluates your solution specifically
4. **Decision** — Recipient is ready to act
5. **Activation** — Recipient takes the key action

Each email should move the recipient one step forward.

### Step 3: Design Each Email

For each email in the sequence:

**Email [N]: [Internal Name]**
| Field | Value |
|-------|-------|
| Send timing | [Day X / Hours after trigger / After event] |
| Subject line | [Primary subject line] |
| Subject line B | [A/B test variant] |
| Preview text | [First ~90 characters visible in inbox] |
| From name | [Person name or company name] |
| Goal | [What this email should accomplish] |
| CTA | [Primary call-to-action button/link text] |
| CTA URL | [Where the CTA goes] |

**Body outline:**
- Opening hook (1-2 sentences): [Connect to their situation]
- Value proposition (2-3 sentences): [What's in it for them]
- Supporting evidence (1-2 sentences): [Social proof, data, example]
- CTA (1 sentence): [Clear ask with one action]
- P.S. (optional): [Secondary hook or urgency]

### Step 4: Add Branching Logic

Sequences shouldn't be linear. Add branches based on behavior:

\`\`\`
Email 1 (Day 0)
├── Opened + Clicked → Email 2A (Day 2) [continue main path]
├── Opened + No Click → Email 2B (Day 3) [re-engage with different angle]
└── No Open → Email 2C (Day 3) [resend with new subject line]

Email 2A (Day 2)
├── Completed activation → Exit sequence, enter "active user" sequence
└── No activation → Email 3 (Day 5) [offer help]
\`\`\`

## Email Writing Best Practices

### Subject Lines
- **Length:** 30-50 characters (mobile-friendly)
- **Personalization:** Use first name or company name when available
- **Curiosity gap:** Hint at value without revealing everything
- **Specificity:** "3 steps to reduce churn by 20%" > "Tips to reduce churn"
- **Avoid spam triggers:** No ALL CAPS, excessive punctuation, or "free"

**Subject line formulas:**
- [Number] + [Noun] + [Benefit]: "5 templates that cut onboarding time in half"
- Question: "Is [common mistake] slowing your [metric]?"
- How-to: "How [similar company] achieved [specific result]"
- Personal: "[First name], quick question about [their goal]"

### Email Body
- **Keep it short.** 100-200 words for transactional/action emails. 200-400 for educational.
- **One CTA per email.** Multiple CTAs reduce click rates by 50%+.
- **Write at a 5th-grade reading level.** Short sentences. Common words.
- **Use white space.** Short paragraphs (1-3 sentences). Bullet points for lists.
- **Mobile-first.** 60%+ of emails open on mobile. Single-column, large buttons.

### Timing
- **B2B:** Tue-Thu, 9-11 AM recipient's timezone
- **B2C:** Varies by audience, test extensively
- **Spacing:** Minimum 2 days between emails. 3-4 days is typical.
- **Don't send on holidays** or weekends (B2B)

## Sequence Output Template

### Sequence: [Name]

**Summary:**
- Emails: [count]
- Duration: [total days]
- Entry trigger: [trigger]
- Exit conditions: [conditions]
- Goal: [primary conversion goal]

**Sequence Map:**

\`\`\`
Day 0:  Email 1 — Welcome + quick win
Day 2:  Email 2 — Core feature education
Day 5:  Email 3 — Social proof / case study
Day 8:  Email 4 — Address common objection
Day 12: Email 5 — Urgency + final CTA
        └── If no conversion → Move to long-term nurture
\`\`\`

**Detailed Emails:**

[Full details for each email as described in Step 3]

**A/B Test Plan:**
| Test | Variant A | Variant B | Metric |
|------|-----------|-----------|--------|
| Email 1 subject | "[Name], welcome" | "Your first step" | Open rate |
| Email 3 CTA | "See the case study" | "Learn how [Company] did it" | Click rate |

**Measurement Plan:**
| Metric | Target | How to Measure |
|--------|--------|---------------|
| Sequence completion rate | >60% | % who receive all emails |
| Overall open rate | >35% | Unique opens / delivered |
| Click-through rate | >5% | Unique clicks / delivered |
| Conversion rate | >10% | Primary goal completed / entered |
| Unsubscribe rate | <2% | Unsubs / delivered |

## Guidelines

- **One goal per email.** Don't ask someone to read a blog post AND book a demo AND follow you on Twitter.
- **Write the subject line last.** Nail the content first, then write a subject line that accurately represents it.
- **Value before ask.** Give something useful (insight, template, tip) before asking for something (demo, purchase, referral).
- **Test everything.** A/B test subject lines, send times, and CTAs. Small improvements compound across the sequence.
- **Respect the exit.** If someone converts, stop the sequence immediately. Nothing erodes trust faster than "book a demo" emails after they already booked one.
- **Plain text often wins.** HTML-heavy emails feel like marketing. Plain text feels like a person. Test both.
- **Sequence ≠ spam.** If you wouldn't send it to a colleague, don't automate it to 10,000 people.`,
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
