import { SystemSkillSeedData } from "../mutations_seed";

export const PDF_SKILL: SystemSkillSeedData = {
  slug: "pdf",
  name: "PDF",
  summary:
    "Read, generate, and regenerate PDF files using NanthAI's persistent runtime. " +
    "Use for PDF extraction, rebuild-style edits, and durable PDF deliverables.",
  instructionsRaw: `# PDF

Use this skill when the task is specifically about PDF files.

## Available Tools

- **read_pdf** — extract text, metadata, page count, and page-level snippets from an uploaded PDF
- **generate_pdf** — create a new PDF from structured sections
- **edit_pdf** — rebuild a revised PDF from an existing uploaded PDF

## Routing Rules

- Use \`read_pdf\` when the user wants to understand, summarize, inspect, or quote an uploaded PDF.
- Use \`generate_pdf\` when the user wants a brand-new PDF deliverable.
- Use \`edit_pdf\` when the user wants a revised version of an existing PDF and a regenerate-style edit is acceptable.

## Editing Model

- PDF editing here is **read and rebuild**, not low-level in-place object patching.
- Preserve the user's intent and structure, but do not promise byte-for-byte layout fidelity to the original source PDF.
- If the user needs the original PDF's exact layout preserved, state that this workflow regenerates the PDF instead.

## Working Style

- Prefer OpenRouter's inline PDF understanding when it is already sufficient for the answer.
- Prefer these PDF tools when attachment parsing failed, the user needs page-aware extraction, or the workflow needs a durable PDF artifact.
- Escalate to richer runtime workflows only when the PDF tools are insufficient for the requested task.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["read_pdf", "generate_pdf", "edit_pdf"],
  requiredToolProfiles: ["persistentRuntime"],
  requiredIntegrationIds: [],
};
