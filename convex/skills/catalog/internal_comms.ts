// convex/skills/catalog/internal_comms.ts
// =============================================================================
// System skill: internal-comms
// Adapted from .agents/skills/internal-comms/SKILL.md for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const INTERNAL_COMMS_SKILL: SystemSkillSeedData = {
  slug: "internal-comms",
  name: "Internal Communications",
  summary:
    "Write internal and stakeholder communications using structured formats — " +
    "status reports, leadership updates, 3P updates, newsletters, FAQs, " +
    "incident reports, project updates, release notes, changelogs, and app-store update copy.",
  instructionsRaw: `# Internal Communications

Write internal communications using structured formats appropriate for the communication type.

## Supported Communication Types

### 3P Updates (Progress, Plans, Problems)
**Format:**
- **Progress:** 3-5 bullet points of what was accomplished this period
- **Plans:** 3-5 bullet points of what's planned for next period
- **Problems:** Any blockers, risks, or issues that need attention (include mitigation if known)

**Tone:** Concise, factual, action-oriented. No fluff.

### Status Reports
**Format:**
- Executive summary (2-3 sentences)
- Key metrics / KPIs with trend indicators
- Accomplishments this period
- Planned work next period
- Risks and mitigations
- Asks / decisions needed

**Tone:** Professional, data-driven. Lead with what matters most.

### Leadership Updates
**Format:**
- TL;DR (1-2 sentences)
- Strategic context (why this matters)
- Key updates with impact
- Decisions needed or FYIs
- Next steps with owners and dates

**Tone:** Strategic, concise. Respect the reader's time — they have many updates to read.

### Company Newsletters
**Format:**
- Catchy subject line
- Welcome / opening (1-2 sentences)
- Sections with headers: Team wins, Product updates, People news, Upcoming events
- Closing with forward-looking note

**Tone:** Warm, celebratory, inclusive. Make people feel connected.

### FAQ Responses
**Format:**
- Question (bold)
- Direct answer (1-2 sentences)
- Additional context if needed
- Related questions / see also

**Tone:** Clear, helpful, non-defensive. Anticipate follow-up questions.

### Incident Reports
**Format:**
- Incident summary (what happened, when, impact)
- Timeline of events
- Root cause analysis
- What we did to resolve
- What we're doing to prevent recurrence
- Action items with owners and dates

**Tone:** Factual, transparent, blameless. Focus on systems, not individuals.

### Project Updates
**Format:**
- Project name and status (On Track / At Risk / Off Track)
- Summary of progress
- Key milestones with dates and status
- Dependencies and blockers
- Resource needs
- Next milestone target

**Tone:** Clear, honest about status. Bad news early.

### Release Notes / Changelogs
**Format:**
- Release title, product name, version, and release date when known
- Highlights: 1-3 sentences on the most important user-visible changes
- New Features, Improvements, Bug Fixes, Breaking Changes, and Deprecations as needed
- For breaking changes: migration guidance, dates, and recommended alternatives

**Tone:** Clear, benefit-focused, and audience-aware. Translate implementation details into what users or stakeholders can now do. Avoid internal ticket numbers and jargon in customer-facing notes.

### App Store / Customer Update Copy
**Format:**
- Short headline or first sentence with the main user benefit
- 2-5 concise bullets for notable additions, improvements, and fixes
- Optional closing line for upgrade or rollout context

**Tone:** Plain, concise, and useful. Do not over-market small maintenance releases.

## General Guidelines

1. **Ask for context** before writing — who's the audience, what's the occasion, what tone?
2. **Match the format** to the communication type above
3. **Be concise** — every sentence should earn its place
4. **Use bullet points** liberally — walls of text don't get read
5. **Include specific dates, names, and numbers** where possible
6. **End with clear next steps** when applicable
7. For release notes and changelogs, separate user-visible value from implementation details
8. If the type doesn't match any above, ask for clarification about the desired format`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "anthropicCurated",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "textOnly",
  requiredToolIds: [],
  requiredIntegrationIds: [],
};
