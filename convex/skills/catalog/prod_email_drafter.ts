// convex/skills/catalog/prod_email_drafter.ts
// =============================================================================
// System skill: email-drafter
// Original NanthAI skill for drafting professional emails.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const EMAIL_DRAFTER_SKILL: SystemSkillSeedData = {
  slug: "email-drafter",
  name: "Email Drafter",
  summary:
    "Draft professional emails for any context — cold outreach, follow-ups, introductions, " +
    "difficult conversations, thank-yous, and announcements. Adapts tone and structure to the situation.",
  instructionsRaw: `# Email Drafter

Draft clear, effective emails that get read and get results. Adapts tone, length, and structure to the context.

## When to Use

- Cold outreach to prospects, partners, or collaborators
- Follow-ups after meetings, events, or unanswered messages
- Introductions connecting two people
- Thank-you notes after interviews, meetings, or favors
- Difficult conversations: delivering bad news, addressing conflict, pushing back
- Announcements: product launches, team changes, policy updates
- Requests: asking for information, favors, approvals, or reviews
- Negotiations: proposals, counter-offers, scope discussions

## Email Structure Framework

Every email follows this skeleton — some sections are one sentence, others are a paragraph:

1. **Subject line** — specific, scannable, gives the reader a reason to open
2. **Opening** — context or connection (why you're writing, how you're connected)
3. **Body** — the substance (one idea per paragraph, shortest paragraph first)
4. **Call to action** — one clear, specific ask
5. **Sign-off** — appropriate warmth for the relationship

## Subject Line Best Practices

- Be specific: "Q3 budget review — need approval by Friday" not "Quick question"
- Front-load the important word: "Interview follow-up: Product Designer role"
- Keep under 50 characters when possible
- Never use ALL CAPS or excessive punctuation
- For replies/forwards, update the subject if the topic has shifted
- Include a deadline if one exists: "Feedback needed by March 20"

## Tone Guide

| Context | Tone | Markers |
|---------|------|---------|
| Executive / Board | Formal, concise | No contractions, structured paragraphs |
| Colleague / Team | Professional, warm | Contractions OK, direct but friendly |
| Client / Partner | Professional, polished | Respectful, confident, solution-oriented |
| Cold Outreach | Conversational, value-first | Short, no jargon, genuine curiosity |
| Difficult News | Empathetic, direct | Lead with the news, acknowledge impact |
| Thank You | Genuine, specific | Reference what you're thanking them for |

## Length Guidelines

- **Default: shorter is better.** Most emails should be 3-8 sentences.
- If the recipient is senior or busy, aim for 3-5 sentences.
- Cold outreach: 4-6 sentences max. If they have to scroll, they won't read it.
- Detailed requests or proposals: use bullet points or numbered lists to break up density.
- If an email exceeds 200 words, consider whether it should be a document with a short cover email.

## Email Type Patterns

### Cold Outreach
- One sentence of genuine connection or research ("I saw your talk at…")
- One sentence of value proposition
- One clear, low-friction ask (not "let's hop on a call" — try "would a 15-min chat on Thursday work?")

### Follow-Up
- Reference the previous interaction with a specific detail
- Add new value or context (don't just say "circling back")
- Restate the ask clearly

### Introduction (Double Opt-In)
- Ask both parties for permission before connecting them
- In the intro email: one sentence on each person, why they should talk, and who should reach out first

### Difficult Conversation
- Lead with the news, don't bury it after pleasantries
- Acknowledge the impact ("I know this isn't the answer you were hoping for")
- Offer a clear next step or alternative
- Keep it factual, not defensive

### Announcement
- Lead with the "what" and "so what" (why it matters to the reader)
- Key details in bullet points
- Link to more information rather than cramming it all in

## Output Format

\`\`\`
**Subject:** [Subject line]

[Email body]

[Sign-off],
[Name]
\`\`\`

If multiple options are appropriate (e.g., different tones), provide 2 drafts labeled **Option A** and **Option B** with a note on when each fits.

## Guidelines

- **One email, one ask.** If you have two unrelated requests, send two emails.
- **Read it from the recipient's perspective.** What do they need to know? What do they need to do?
- **Front-load the important information.** Many people only read the first 2 lines.
- **Avoid throat-clearing openings** ("I hope this email finds you well" adds zero value in most contexts).
- **Be specific about next steps.** "Let me know" is weaker than "Could you reply by Friday with your preference?"
- **Proofread for tone.** Read it aloud. If it sounds curt, add one warm sentence. If it sounds rambling, cut a paragraph.

## Quality Checklist

- [ ] Subject line is specific and under 50 characters
- [ ] The purpose of the email is clear within the first 2 sentences
- [ ] There is exactly one call to action
- [ ] Tone matches the relationship and context
- [ ] No unnecessary pleasantries or filler
- [ ] Spelling and grammar are correct
- [ ] The email is under 200 words (or has a good reason to be longer)
- [ ] A deadline is included if one exists`,
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
