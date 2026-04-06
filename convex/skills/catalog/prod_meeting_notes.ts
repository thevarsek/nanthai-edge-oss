// convex/skills/catalog/prod_meeting_notes.ts
// =============================================================================
// System skill: meeting-notes
// Original NanthAI skill for structured meeting note-taking.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const MEETING_NOTES_SKILL: SystemSkillSeedData = {
  slug: "meeting-notes",
  name: "Meeting Notes",
  summary:
    "Transform meeting transcripts or raw notes into structured meeting summaries with " +
    "decisions, action items, and follow-ups. Use after any meeting to capture outcomes.",
  instructionsRaw: `# Meeting Notes

Transform raw meeting notes, transcripts, or voice memos into clear, structured summaries that capture what happened, what was decided, and what happens next.

## When to Use

- After team meetings, standups, sprint reviews, or retrospectives
- Following 1:1s, client calls, or stakeholder reviews
- Processing voice transcripts or rough bullet-point notes
- When you need a clean record of decisions and action items
- Summarizing long meeting recordings or chat logs

## How to Process Raw Input

1. **Identify the meeting type** — standup, review, 1:1, all-hands, client call, or brainstorm (this shapes the output structure)
2. **Extract attendees** — who was there, who was absent but mentioned
3. **Identify decisions** — any "we agreed," "let's go with," "decision:" moments
4. **Pull action items** — look for commitments: "I'll do X," "can you handle Y," deadlines mentioned
5. **Separate discussion from decisions** — most of a meeting is discussion; decisions are the signal
6. **Note unresolved items** — topics raised but not closed go into the parking lot

## Meeting Type Templates

### Standup / Daily Sync
Focus on: blockers, progress since last sync, plan for today. Keep extremely short.

### Sprint Review / Demo
Focus on: what was shipped, stakeholder feedback, accepted vs needs-revision, next sprint priorities.

### 1:1
Focus on: personal updates, career topics, feedback given/received, agreed next steps. Mark sensitive items.

### All-Hands / Town Hall
Focus on: company updates, key announcements, Q&A highlights, strategic themes.

### Client Call
Focus on: client requirements, commitments made, timeline discussed, open questions, internal follow-ups.

### Brainstorm / Working Session
Focus on: ideas generated, ideas shortlisted, evaluation criteria, next steps to validate.

## Output Format

\`\`\`markdown
# [Meeting Title]

**Date:** YYYY-MM-DD
**Attendees:** [Names]
**Absent/Regrets:** [Names, if known]
**Meeting Type:** [Standup | Sprint Review | 1:1 | All-Hands | Client Call | Brainstorm]

## Agenda / Topics Covered
1. [Topic A]
2. [Topic B]

## Key Discussion Points
- **[Topic A]:** [2-3 sentence summary of the discussion, positions taken, and reasoning]
- **[Topic B]:** [Summary]

## Decisions Made
| # | Decision | Rationale | Owner |
|---|----------|-----------|-------|
| 1 | [What was decided] | [Why] | [Who owns it] |

## Action Items
| # | Action | Owner | Due Date | Status |
|---|--------|-------|----------|--------|
| 1 | [Task] | [Name] | [Date] | Open |

## Follow-Ups
- [Items that need further discussion or input before a decision]

## Parking Lot
- [Topics raised but deferred to a future meeting]
\`\`\`

## Guidelines

- **Attribution matters.** Tie decisions and action items to specific people.
- **Decisions over discussions.** A meeting note that only captures "we talked about X" is useless. Push to identify what was actually decided.
- **Be concise.** A 60-minute meeting should produce 1 page of notes, not 5.
- **Use the owner's actual name**, not "the team" or "someone."
- **Due dates should be specific.** "Soon" is not a date. If no date was set, write "TBD" and flag it.
- **Separate facts from interpretations.** If you're inferring a decision from context, mark it: "(implied)" or "(to confirm)."
- **For transcripts:** ignore filler, small talk, and tangents. Extract only substantive content.

## Quality Checklist

- [ ] Every decision has an owner
- [ ] Every action item has an owner and a due date (or explicit TBD)
- [ ] Discussion summaries are 2-3 sentences, not full transcripts
- [ ] Attendees are listed accurately
- [ ] No action items are buried inside discussion paragraphs
- [ ] Parking lot captures deferred topics so they aren't lost
- [ ] The note is short enough that someone who missed the meeting would actually read it`,
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
