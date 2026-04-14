// convex/skills/catalog/documents.ts
// =============================================================================
// System skill: documents
// Generic document workflow entry point for NanthAI's docs profile.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DOCUMENTS_SKILL: SystemSkillSeedData = {
  slug: "documents",
  name: "Documents",
  summary:
    "Read, create, and revise attached or requested documents and text files. " +
    "Use this as the general entry point for .docx, .pptx, .xlsx, .pdf, .txt, .md, .csv, and .eml work when no narrower format-specific skill is an obvious match.",
  instructionsRaw: `# Documents Skill

Use this skill as the general document workflow entry point inside NanthAI.

This skill unlocks the document tool family. Prefer it when the user asks to:

- read or summarize an attached file
- compare multiple attached documents
- create a durable text or office file
- revise a document while preserving its overall format
- work with document formats but without an obvious narrow skill choice

## Available Tools

- **read_docx / edit_docx / generate_docx** for Word documents and rich text reports
- **read_pptx / edit_pptx / generate_pptx** for slide decks
- **read_xlsx / edit_xlsx / generate_xlsx** for spreadsheets
- **read_pdf / edit_pdf / generate_pdf** for PDFs and PDF rebuild workflows
- **read_text_file / generate_text_file** for .txt, .md, and .csv files
- **read_eml / generate_eml** for .eml email files

## Routing Rules

Pick the tool that matches the file's actual format.

- \`.docx\` → use \`read_docx\` or \`edit_docx\`
- \`.pptx\` → use \`read_pptx\` or \`edit_pptx\`
- \`.xlsx\` → use \`read_xlsx\` or \`edit_xlsx\`
- \`.pdf\` → use \`read_pdf\` or \`edit_pdf\`
- \`.txt\`, \`.md\`, \`.csv\` → use \`read_text_file\`
- \`.eml\` → use \`read_eml\`

If the user only wants to understand an attached file, read it first and answer directly.

If the user wants a polished output file, read the source if needed, then generate a new file in the target format.

## When To Load A Narrower Skill

After loading this skill, switch to a format-specific skill when the task needs deeper format guidance:

- load \`docx\` for structured reports, formal documents, TOCs, page numbers, or tracked-change-style rewrites
- load \`pptx\` for slide design, speaker-flow structure, deck narrative, or image/chart placement
- load \`xlsx\` for workbook structure, tab planning, formulas, and polished spreadsheet deliverables
- load \`pdf\` when the task is specifically about PDFs, PDF regeneration, page-aware extraction, or fallback beyond OpenRouter's inline PDF context

## Working Style

- Read before editing when the source file matters.
- For formatting-heavy rewrites, preserve the format family instead of converting casually.
- For plain-text attachments, summarize directly unless the user explicitly wants a saved output file.
- Do not use runtime/workspace tools for ordinary document reading when a named document tool already covers the task.
- For PDFs, prefer the PDF tools over generic runtime commands unless you are escalating into a more complex document-processing workflow.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["read_pdf", "generate_pdf", "edit_pdf"],
  requiredToolProfiles: ["docs", "persistentRuntime"],
  requiredIntegrationIds: [],
};
