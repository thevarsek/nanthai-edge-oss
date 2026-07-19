// convex/skills/catalog/docx.ts
// =============================================================================
// System skill: docx
// Adapted from .agents/skills/docx/SKILL.md for NanthAI runtime.
// NanthAI has generate_docx, read_docx, edit_docx, and propose_docx_edits tools.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DOCX_SKILL: SystemSkillSeedData = {
  slug: "docx",
  name: "Word Documents",
  summary:
    "Create, read, edit, and manipulate Word documents (.docx). Covers professional formatting, " +
    "tables of contents, headings, page numbers, letterheads, tracked changes, comments, and " +
    "content extraction. Use when working with .docx files, redline-style reviews, or producing professional documents.",
  instructionsRaw: `# Word Document (DOCX) Skill

Create, read, and edit Word documents using NanthAI's document tools.

## Multi-participant and Ideascape safety

Reading and reviewing Word documents may use multiple participants. Creating, replacing, or proposing tracked changes requires one participant. If more than one participant is active, do not claim a write succeeded; tell the user: "Presentation and Word document creation or editing require a single participant. Open + → Participants and remove participants until only one remains, then try again. You can add the others back afterward."

Ideascape may open Word artifacts for review, but document edits stay in normal chat. Ask the user to open the artifact, return to Chat, and attach or stage it there.

## Tools

- **generate_docx** — Create a new .docx from structured sections
- **read_docx** — Extract text and metadata from an existing .docx
- **edit_docx** — Replace an entire existing .docx only for an explicit whole-document rewrite (read → regenerate)
- **propose_docx_edits** — Default for localized edits; add precise Word tracked changes for per-edit Accept/Reject review

## Quick-Start Recipe

For most documents, just provide \`title\` and \`sections\`. Everything else has sensible defaults:

\`\`\`
generate_docx({
  title: "Quarterly Report",
  sections: [
    { heading: "Executive Summary", body: "Revenue grew 23% YoY..." },
    { heading: "Key Metrics", headingLevel: 2, body: "Details here..." }
  ]
})
\`\`\`

Defaults applied automatically: Calibri 11pt, 1.15× line spacing, 1" margins. You rarely need to override these.

## When to Add Formatting

Only reach for optional params when the user explicitly asks or the document type demands it:

| User request | Params to add |
|---|---|
| "Use Times New Roman" | \`fontFamily: "Times New Roman"\` |
| "Double spaced" | \`lineSpacing: 2.0\` |
| "Add page numbers" | \`showPageNumbers: true\` |
| "Include a table of contents" | \`includeToc: true\` |
| "Company name in the header" | \`headerText: "Acme Corp"\` |
| "Narrow margins" | \`margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }\` |

## Heading Levels

Use \`headingLevel\` (1–6) on sections to create document hierarchy. Default is 1 if omitted.

- **H1** — Major sections (26pt, bold)
- **H2** — Subsections (20pt, bold)
- **H3** — Sub-subsections (16pt, bold)
- **H4–H6** — Deeper nesting (progressively smaller)

Rule: H1 for top-level sections, H2 for subsections within them, H3 when needed. Rarely go deeper than H3.

## Inline Formatting

Use markdown-style markers in body text:
- \`**bold text**\` → **bold**
- \`*italic text*\` → *italic*
- \`***bold and italic***\` → ***bold italic***

Newlines in body text create separate paragraphs.

## Tables

Add a \`table\` object to any section to render a table after the body text:

\`\`\`
{
  heading: "Revenue Breakdown",
  body: "Revenue by region for Q1 2025:",
  table: {
    headers: ["Region", "Revenue", "Growth"],
    rows: [
      ["North America", "$2.4M", "+18%"],
      ["Europe", "$1.8M", "+12%"]
    ],
    columnWidths: [3, 2, 1.5]  // optional, in inches
  }
}
\`\`\`

Tables have dark blue headers (white text) and full-width layout. Column widths auto-size if omitted.

## Headers, Footers, and TOC

- \`headerText\` — Text in top-right of every page (italic, gray). Use for document title or company name.
- \`showPageNumbers: true\` — Centered footer: "Page X of Y".
- \`includeToc: true\` — Table of Contents after the title, linked to headings. Best for 4+ sections.

## Available Formatting Parameters (all optional)

| Parameter | Default | Notes |
|---|---|---|
| fontFamily | "Calibri" | Body font. Common: Arial, Times New Roman, Georgia |
| fontSize | 11 | Body size in points. Headings scale proportionally |
| headingFont | same as fontFamily | For contrast, e.g. Georgia headings + Arial body |
| lineSpacing | 1.15 | Multiplier: 1.0 single, 1.5 one-and-half, 2.0 double |
| margins | 1" all sides | Object: { top, right, bottom, left } in inches |
| headerText | (none) | Page header text |
| showPageNumbers | false | "Page X of Y" footer |
| includeToc | false | Table of Contents |

## Editing Documents

For any localized change to an existing DOCX, including a date, name, number, clause, typo, signature field, or formatting correction, use **read_document** or **find_in_document** and then **propose_docx_edits**. This is the default even when the user says "change," "edit," or "update" without explicitly asking for tracked changes. The resulting edits must remain reviewable through the user's per-edit Accept/Reject controls.

Example: for "change the date to today," resolve today's date from the supplied current-date context, find the exact date in the source document, and call **propose_docx_edits** with one minimal replacement. Do not call **edit_docx** for that request.

Use **edit_docx** only when the user explicitly requests a whole-document rewrite, rebuild, regeneration, or replacement. edit_docx uses a read → regenerate approach: the original file is read for context, then a brand-new document is built with the provided sections. Workflow:

1. Use **read_docx** to understand the existing content and structure
2. Call **edit_docx** with storageId + the full updated title/sections
3. All formatting params from generate_docx are available on edit_docx too

The model must provide the complete document content — this is a full replacement, not a patch.

## Localized Edits and Tracked-Change Requests

When the user asks for any localized edit, redline, tracked changes, accept/reject edits, or clause-level revisions in an existing DOCX, distinguish the requested workflow from explicit full-document regeneration:

- **Current edit_docx behavior:** full replacement document generated from supplied sections.
- **Tracked-change behavior:** use read_document or find_in_document first, then call propose_docx_edits with minimal find/replace edits and short source-copied context anchors. The backend preserves the Word document and exposes accept/reject state.

Do not present edit_docx output as true Word tracked changes. If propose_docx_edits reports ambiguous or missing anchors, re-read the relevant section and retry with longer context. If tracked-change tooling is unavailable or unsupported for the file, offer a redline-style review with precise proposed changes, reasons, and citations, or generate a revised DOCX only after the user accepts that it is a replacement draft.

## Document Type Recipes

### Business Letter
- fontFamily: "Times New Roman", fontSize: 12, lineSpacing: 1.0
- Sections: Date → Recipient → Body → Closing → Signature
- No TOC, no page numbers (single page)

### Technical Report
- includeToc: true, showPageNumbers: true
- H1 for major sections, H2 for subsections
- Tables for data, inline **bold** for key terms
- headerText: document title or "CONFIDENTIAL"

### Meeting Minutes
- Keep defaults (Calibri 11pt)
- Sections: Attendees, Agenda Items, Decisions, Action Items
- Tables for action items (columns: Action, Owner, Deadline)

### Proposal
- headingFont: "Georgia" (contrast with Calibri body)
- includeToc: true, showPageNumbers: true
- Sections: Executive Summary, Scope, Timeline, Pricing, Terms

## Content Quality

- **One idea per paragraph.** Keep paragraphs to 3–5 sentences.
- **Active voice.** "Revenue grew 23%" not "A growth of 23% was observed."
- **Consistent terminology.** Same term for the same concept throughout.
- **Heading = takeaway.** "Revenue grew 23% in Q1" not just "Revenue."`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "anthropicCurated",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["generate_docx", "read_docx", "edit_docx", "propose_docx_edits"],
  requiredToolProfiles: ["docs"],
  requiredIntegrationIds: [],
};
