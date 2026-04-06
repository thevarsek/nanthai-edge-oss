// convex/skills/catalog/doc_coauthoring.ts
// =============================================================================
// System skill: doc-coauthoring
// Adapted from .agents/skills/doc-coauthoring/SKILL.md for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DOC_COAUTHORING_SKILL: SystemSkillSeedData = {
  slug: "doc-coauthoring",
  name: "Doc Co-Authoring",
  summary:
    "Guide users through a structured 3-stage workflow for co-authoring documentation, " +
    "proposals, technical specs, decision docs, and similar structured content. " +
    "Trigger when user mentions writing docs, creating proposals, drafting specs, or similar.",
  instructionsRaw: `# Doc Co-Authoring Workflow

Structured workflow for collaborative document creation. Act as an active guide through three stages: Context Gathering, Refinement & Structure, and Reader Testing.

## When to Offer

Trigger conditions:
- User mentions writing docs: "write a doc", "draft a proposal", "create a spec", "write up"
- Specific doc types: "PRD", "design doc", "decision doc", "RFC"
- Substantial writing task starting

Offer the 3-stage workflow:
1. **Context Gathering**: User provides context, you ask clarifying questions
2. **Refinement & Structure**: Build each section via brainstorming and editing
3. **Reader Testing**: Test the doc for blind spots before sharing

## Stage 1: Context Gathering

**Goal:** Close the gap between what the user knows and what you know.

Ask initial meta-context questions:
1. What type of document? (tech spec, decision doc, proposal)
2. Who's the primary audience?
3. What's the desired impact?
4. Template or specific format?
5. Constraints or additional context?

Encourage info dumping — background, team discussions, alternative solutions, organizational context, timeline, architecture, stakeholder concerns. Tell them not to worry about organizing it.

Track what's learned and what's unclear. After substantial context, generate 5-10 numbered clarifying questions. Let them answer in shorthand.

**Exit condition:** Questions show understanding of edge cases and trade-offs without needing basics explained.

## Stage 2: Refinement & Structure

**Goal:** Build the document section by section through brainstorming, curation, and iterative refinement.

For each section:
1. **Clarifying questions** — 5-10 questions about what to include
2. **Brainstorming** — 5-20 options, looking for forgotten context and new angles
3. **Curation** — User keeps/removes/combines (e.g. "Keep 1,4,7,9", "Remove 3 (duplicates 1)")
4. **Gap check** — Anything important missing?
5. **Drafting** — Write the section based on selections
6. **Iterative refinement** — User gives feedback, make surgical edits

Start with whichever section has the most unknowns (usually the core proposal/approach). Summary sections last.

After 3 iterations with no substantial changes, ask if anything can be removed.

At 80%+ completion, re-read the entire document checking for:
- Flow and consistency across sections
- Redundancy or contradictions
- Generic filler
- Whether every sentence carries weight

## Stage 3: Reader Testing

**Goal:** Test the document with fresh eyes to catch blind spots.

### Step 1: Predict Reader Questions
Generate 5-10 questions readers would realistically ask when discovering this document.

### Step 2: Self-Test
For each question, answer as if reading the document fresh (no context from the conversation). Flag where the document is unclear or assumes too much.

### Step 3: Additional Checks
Check for:
- Ambiguity or unclear sections
- Knowledge/context the doc assumes readers already have
- Internal contradictions or inconsistencies

### Step 4: Fix Issues
Report specific issues found and loop back to Stage 2 refinement for problematic sections.

**Exit condition:** Questions are consistently answerable from the document alone with no new gaps.

## Final Review

When Reader Testing passes:
1. Recommend a final read-through — they own this document
2. Suggest double-checking facts, links, technical details
3. Ask them to verify it achieves the desired impact

Final tips:
- Use appendices for depth without bloating the main doc
- Update the doc as feedback comes from real readers

## Tips for Effective Guidance

**Tone:** Direct and procedural. Brief rationale when it affects user behavior.

**Handling Deviations:** If user wants to skip a stage, offer freeform. If frustrated, acknowledge and suggest ways to move faster.

**Quality over Speed:** Don't rush stages. Each iteration should make meaningful improvements.`,
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
