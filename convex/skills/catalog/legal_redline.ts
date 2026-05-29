import { SystemSkillSeedData } from "../mutations_seed";

export const LEGAL_REDLINE_SKILL: SystemSkillSeedData = {
  slug: "legal-redline",
  name: "Legal Redline",
  summary:
    "Prepare narrow DOCX legal redlines with tracked-change proposals, concise reasons, and fallback redline tables when true tracked changes are unavailable.",
  instructionsRaw: `# Legal Redline

Use this skill only when the user explicitly asks for a legal or contract redline, tracked changes, markups, clause-level revisions, negotiation edits, buyer/seller/lender/borrower-friendly changes, or a cleanup pass where reviewable tracked changes are requested.

Do not use this skill for generic document summaries, general document review, ordinary contract summaries, or issue spotting that does not ask for redlines or tracked changes.

Important disclaimer: This output is for informational purposes only and does not constitute legal advice. The user should consult qualified counsel before making binding legal decisions.

Workflow:
1. Use list_documents when the target document is unclear.
2. Use read_document or find_in_document before proposing edits.
3. For scoped DOCX files, call propose_docx_edits with the smallest meaningful substitutions and short context anchors copied from the document.
4. Include concise legal or business reasons on each edit.
5. Prefer clause-level edits over whole-agreement rewrites unless the user asks for a replacement draft.
6. If propose_docx_edits reports ambiguous or missing anchors, re-read the relevant section and retry with longer context.
7. If the file is not DOCX or true tracked changes cannot be applied, return a redline-style table with columns: clause, current text, proposed replacement, reason, risk, and citation.

Keep legal prompting inside this skill. Do not introduce a separate backend path or product mode; propose_docx_edits is the canonical tracked-change tool.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["list_documents", "read_document", "find_in_document", "propose_docx_edits"],
  requiredToolProfiles: ["docs"],
  requiredIntegrationIds: [],
};
