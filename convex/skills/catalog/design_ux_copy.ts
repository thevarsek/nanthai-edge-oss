// convex/skills/catalog/design_ux_copy.ts
// =============================================================================
// System skill: ux-copy
// UX writing and microcopy for digital products.
// Inspired by Anthropic knowledge-work-plugins/design (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const UX_COPY_SKILL: SystemSkillSeedData = {
  slug: "ux-copy",
  name: "UX Copy",
  summary:
    "Write and audit UI copy — button labels, error messages, empty states, onboarding flows, " +
    "tooltips, and notification text. Covers voice and tone, content hierarchy, and " +
    "accessibility for interface text.",
  instructionsRaw: `# UX Copy Writing

Write clear, helpful, and human interface copy for digital products. UX copy guides users through actions, prevents confusion, and shapes how a product feels.

## When to Use

- Writing button labels, menu items, and navigation text
- Crafting error messages, validation text, and recovery flows
- Designing empty states, zero-data states, and first-run experiences
- Writing onboarding flows and feature announcements
- Creating tooltip text, help text, and inline guidance
- Auditing existing UI copy for clarity and consistency
- Writing notification copy (push, email, in-app)
- Naming features, settings, and menu items

## Core Principles

1. **Clarity over cleverness.** Users are trying to complete a task, not appreciate your wordplay.
2. **Front-load the important word.** "Delete this project?" not "Are you sure you want to delete?"
3. **Use the user's language.** Match their mental model, not your internal jargon.
4. **Be concise.** Every word must earn its place. Cut ruthlessly.
5. **Be specific.** "Photo saved to Camera Roll" beats "Action completed successfully."
6. **Be consistent.** Same action = same word. Don't alternate between "remove," "delete," and "trash."

## Copy Types and Patterns

### Button Labels
- Use verbs: "Save," "Send," "Create Account" — not "OK" or "Submit"
- Be specific: "Add to Cart" not "Continue"
- Pair destructive actions with what's being destroyed: "Delete Project" not just "Delete"
- Primary action should be a verb + noun: "Create Report," "Send Invite"
- Cancel should always be available and never be the visual primary

### Error Messages
Structure: **What happened** + **Why** + **What to do next**

Good: "We couldn't save your changes because the file is too large (max 25 MB). Try compressing the image or using a smaller file."
Bad: "Error 413: Request entity too large."

Rules:
- Never blame the user ("You entered an invalid email" → "This email address doesn't look right")
- Be specific about what went wrong
- Tell them how to fix it
- Avoid technical jargon (no error codes, no stack traces)
- Use sentence case, not ALL CAPS

### Empty States
Every empty state should answer: **What goes here?** + **Why it matters** + **How to start**

Structure:
- Illustration or icon (optional — describe it)
- Headline: What this space is for
- Body: Brief value proposition or explanation
- CTA: The action to populate this space

Example:
> **No projects yet**
> Projects help you organize your work into focused spaces. Each project gets its own files, tasks, and team members.
> [Create Your First Project]

### Onboarding / First-Run
- Keep steps to 3-5 maximum
- Show progress (step 2 of 4)
- Let users skip — they can always come back
- Focus on the ONE thing they need to do to get value
- Use progressive disclosure — don't explain everything upfront

### Tooltips and Help Text
- Tooltips: Max 1-2 sentences. Answer "what does this do?"
- Help text below form fields: Explain format or constraints ("Must be at least 8 characters")
- Inline hints: Show examples, not rules ("e.g., john@example.com")

### Confirmation Dialogs
Structure: **What will happen** + **Is it reversible?** + **Clear action labels**

- Title: State what's about to happen ("Delete this project?")
- Body: Consequences and reversibility ("This will permanently delete 'Acme Project' and all its files. This cannot be undone.")
- Primary action: Specific verb matching the title ("Delete Project" not "Yes")
- Secondary action: "Cancel" (always)

### Notifications
- **Push:** Max 2 lines. Lead with what changed. "Sarah commented on your design" not "New comment notification."
- **In-app:** Action-oriented. Include a clear path forward.
- **Email subject lines:** Specific and scannable. "[Project Name] Sarah left feedback on Homepage v2"

### Loading and Progress States
- < 2 seconds: No message needed, use a spinner
- 2-10 seconds: Brief message ("Loading your projects...")
- 10+ seconds: Progress indicator with estimate ("Uploading 3 of 12 files...")
- After completion: Confirm what happened ("12 files uploaded successfully")

### Settings and Preferences
- Label: What the setting controls ("Email notifications")
- Description: What changes when you toggle it ("Receive an email when someone comments on your work")
- Current state should be obvious without reading the label

## Voice and Tone Guide

**Voice** (constant — who you are):
- Clear and direct
- Helpful, not condescending
- Human, not robotic
- Confident, not arrogant

**Tone** (variable — adapts to context):
| Context | Tone | Example |
|---------|------|---------|
| Success | Warm, encouraging | "You're all set! Your project is live." |
| Error | Calm, helpful | "Something went wrong. Let's try that again." |
| Warning | Direct, informative | "You have unsaved changes. Leave anyway?" |
| Onboarding | Friendly, motivating | "Let's get you set up — it only takes a minute." |
| Destructive action | Serious, clear | "This will permanently delete your account and all data." |
| Empty state | Encouraging, action-oriented | "No messages yet. Start a conversation to get going." |

## Copy Audit Checklist

When auditing existing copy:

- [ ] Every button label is a verb (or verb + noun)
- [ ] Error messages explain what happened AND what to do
- [ ] No jargon or internal terminology facing users
- [ ] Consistent terminology (same thing = same word everywhere)
- [ ] Empty states have a headline, explanation, and CTA
- [ ] Confirmation dialogs state consequences clearly
- [ ] No "Click here" links — link text describes the destination
- [ ] Sentence case used throughout (not Title Case For Everything)
- [ ] Numbers are formatted for readability (1,234 not 1234)
- [ ] Dates use the user's locale format
- [ ] Placeholder text in forms shows the expected format
- [ ] All copy reads well when spoken aloud (screen reader test)

## Output Format

When writing copy, deliver it as:

| Element | Copy | Notes |
|---------|------|-------|
| Page title | ... | Max 60 chars for SEO |
| Headline | ... | What this screen is for |
| Body | ... | Supporting context |
| Primary CTA | ... | Verb + noun |
| Secondary CTA | ... | Alternative action |
| Error: [case] | ... | What happened + fix |
| Empty state | ... | Headline + body + CTA |
| Tooltip: [element] | ... | 1-2 sentences max |

## Guidelines

- **Read it aloud.** If it sounds awkward spoken, rewrite it.
- **Test at extremes.** Does the layout break with a long name? With zero items? With 10,000 items?
- **Consider localization.** German text is ~30% longer than English. Leave room.
- **Write for scanning.** Users don't read — they scan. Put the key info first.
- **One idea per sentence.** Complex sentences create complex interfaces.`,
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
