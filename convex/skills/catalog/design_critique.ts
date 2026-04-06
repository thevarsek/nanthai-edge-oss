// convex/skills/catalog/design_critique.ts
// =============================================================================
// System skill: design-critique
// Structured UI/UX critique and accessibility review.
// Inspired by Anthropic knowledge-work-plugins/design (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DESIGN_CRITIQUE_SKILL: SystemSkillSeedData = {
  slug: "design-critique",
  name: "Design Critique",
  summary:
    "Conduct structured UI/UX design critique using established heuristics (Nielsen's 10, " +
    "Gestalt principles) and WCAG accessibility review. Use when reviewing mockups, " +
    "screenshots, live UI descriptions, or design system components.",
  instructionsRaw: `# Design Critique & Accessibility Review

Provide structured, actionable feedback on user interface and user experience designs. Combine heuristic evaluation, accessibility auditing, and interaction design principles to surface issues and opportunities.

## When to Use

- Reviewing UI mockups, wireframes, or screenshots
- Auditing an existing interface for usability issues
- Evaluating design system components for consistency
- Checking designs for WCAG accessibility compliance
- Providing design feedback before development handoff
- Assessing information architecture and navigation patterns

## Critique Framework

### Step 1: First Impressions (5-second test)
- What is the primary action on this screen?
- Is the visual hierarchy clear — can you tell what matters most?
- Does the layout feel balanced or cluttered?
- Is the purpose of the page immediately obvious?

### Step 2: Heuristic Evaluation (Nielsen's 10)

Evaluate against each of Jakob Nielsen's 10 usability heuristics. For each, score as Pass / Minor Issue / Major Issue:

1. **Visibility of system status** — Does the user know where they are and what's happening? Are loading states, progress indicators, and feedback present?
2. **Match between system and real world** — Does it use language and concepts the user understands? Are metaphors appropriate?
3. **User control and freedom** — Can users undo, go back, and escape? Are there emergency exits?
4. **Consistency and standards** — Do similar elements behave similarly? Does it follow platform conventions?
5. **Error prevention** — Does the design prevent errors before they happen? Are dangerous actions guarded with confirmation?
6. **Recognition rather than recall** — Is information visible or easily retrievable? Do users have to remember things between screens?
7. **Flexibility and efficiency of use** — Are there shortcuts for power users? Can the interface adapt to different skill levels?
8. **Aesthetic and minimalist design** — Does every element earn its place? Is there unnecessary visual noise?
9. **Help users recognize, diagnose, and recover from errors** — Are error messages clear, specific, and constructive?
10. **Help and documentation** — Is help available in context? Can users find what they need without leaving the flow?

### Step 3: Visual Design Assessment

- **Typography:** Is the type hierarchy clear? Are fonts readable at all sizes? Is line height/spacing adequate?
- **Color:** Does the palette support the hierarchy? Is there sufficient contrast (WCAG AA = 4.5:1 for normal text, 3:1 for large text)? Is color used as the sole indicator of anything?
- **Spacing:** Is the spacing system consistent? Do related items feel grouped (Gestalt proximity)?
- **Layout:** Is the grid consistent? Does the layout respond well to different viewport sizes?
- **Imagery/Icons:** Are icons recognizable without labels? Are images purposeful or decorative?

### Step 4: Interaction Design

- **Affordances:** Do interactive elements look clickable/tappable?
- **Feedback:** Does every action produce visible feedback?
- **Transitions:** Are state changes smooth and predictable?
- **Touch targets:** Are tap targets at least 44x44pt (iOS) / 48x48dp (Android)?
- **Cognitive load:** How many decisions does the user need to make on this screen?

### Step 5: Accessibility Audit (WCAG 2.1 AA)

Check against the four WCAG principles:

**Perceivable:**
- Text alternatives for non-text content (images, icons, charts)
- Captions/transcripts for audio/video content
- Content is presentable without loss of information at 200% zoom
- Minimum contrast ratios met (4.5:1 normal text, 3:1 large text, 3:1 UI components)
- Content doesn't rely solely on color to convey meaning

**Operable:**
- All functionality available via keyboard
- No keyboard traps
- Users can pause, stop, or hide moving content
- No content that flashes more than 3 times per second
- Skip navigation links provided
- Focus order is logical and predictable

**Understandable:**
- Language of page is programmatically determinable
- Navigation is consistent across pages
- Error identification is specific and suggestions are provided
- Labels and instructions are clear

**Robust:**
- Valid, well-structured markup
- Name, role, value available for all UI components
- Status messages can be programmatically determined

### Step 6: Synthesis and Recommendations

Organize findings by severity:

- **Critical** — Blocks core user tasks or fails WCAG A criteria
- **Major** — Significant usability friction or WCAG AA failure
- **Minor** — Small improvements that would polish the experience
- **Enhancement** — Opportunities beyond compliance

## Output Format

### Design Critique: [Screen/Component Name]

**Overall Assessment:** [1-2 sentence summary]

**Severity Summary:**
| Level | Count | Key Areas |
|-------|-------|-----------|
| Critical | X | ... |
| Major | X | ... |
| Minor | X | ... |

**Heuristic Scores:**
| Heuristic | Rating | Notes |
|-----------|--------|-------|
| Visibility of system status | Pass/Minor/Major | ... |
| ... | ... | ... |

**Detailed Findings:**

For each finding:
- **Issue:** What's wrong
- **Location:** Where in the design
- **Severity:** Critical / Major / Minor
- **Heuristic/Principle:** Which principle it violates
- **Recommendation:** How to fix it
- **Example:** (if applicable) How others solve this well

**Accessibility Checklist:**
- [ ] Color contrast meets AA ratios
- [ ] Interactive elements have visible focus states
- [ ] Images have alt text
- [ ] Form fields have associated labels
- [ ] Error messages are descriptive
- [ ] Touch targets meet minimum size
- [ ] Content is readable at 200% zoom

**Top 3 Priorities:**
1. [Most impactful change with rationale]
2. [Second priority]
3. [Third priority]

## Guidelines

- **Be specific.** "The CTA button lacks contrast" is better than "the design needs work."
- **Be constructive.** Every criticism should come with a concrete recommendation.
- **Distinguish severity.** Not every issue is critical — help the team prioritize.
- **Acknowledge strengths.** Note what works well so it's preserved during iteration.
- **Consider context.** A consumer app and an enterprise admin panel have different design standards.
- **Don't redesign.** The goal is to improve the existing design, not impose a different one.`,
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
