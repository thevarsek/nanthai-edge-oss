// convex/skills/catalog/document_generation_workflows.ts
// =============================================================================
// M33 document generation and template-like workflow skills.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

const DOCS_PROFILE = ["docs"] as const;

export const DOCUMENT_REVIEW_SKILL: SystemSkillSeedData = {
  slug: "document-review",
  name: "Document Review",
  summary:
    "Review scoped documents with quote-backed citations, redline-style change lists, and bounded document comparisons that can be exported to XLSX.",
  instructionsRaw: `# Document Review

Use this skill when the user asks to review, summarize, critique, compare, or risk-check one or more scoped documents.

Core review workflow:
1. Use list_documents when the document set is unclear.
2. Use read_document for the relevant document text.
3. Use find_in_document for targeted clauses, defined terms, dates, obligations, or suspected issues.
4. Cite document-specific claims with the existing document citation rules.
5. Separate facts from recommendations.
6. If the user asks for true DOCX tracked changes, use read_document or find_in_document first, then propose_docx_edits with minimal source-anchored substitutions. Without that tool or for non-DOCX files, return a redline-style issue/change list with quotes, reasons, and recommended replacement wording.

## Bounded document comparisons

When the user asks to compare documents, build an extraction grid, or produce a review matrix:

1. Start with list_documents. Use only documents scoped to the current chat. Do not silently default to a fixed number of documents and do not add Knowledge Base files that the user did not attach or select.
2. Propose a concise column set from the user's request. Always include Source document as the first column and add citation, quote, clause, page, or section fields when they help verify the result.
3. Before reading every document, show the exact document count, proposed columns, and work units as documents × comparison columns. Explain that PAYG usage grows with source length, column count, selected model pricing, and tool rounds, so an exact price is not known in advance.
4. Ask for a separate, explicit confirmation of that scope. Do not treat the original comparison request as confirmation and do not start the full comparison in the same response as the scope proposal.
5. After confirmation, call list_documents again. If the source set or requested columns changed, show the revised work units and reconfirm before continuing.
6. Perform one bounded chat/tool-loop comparison. Do not fan out an independent model call per cell or document, use subagents, add web research, or invoke analytics/runtime tools unless the user explicitly asks for that extra work.
7. Use read_document and find_in_document economically. Disclose truncation or unsupported content. Write "Not found" when a requested fact is absent rather than guessing, and keep material claims traceable to document citations.
8. If the confirmed scope cannot fit the available context or tool-round budget, stop and ask the user to narrow the documents or columns. Do not invent a hidden fixed limit.
9. Return a compact Markdown preview, then use generate_xlsx for the complete comparison. The normal generated-file card is the deliverable; do not claim to create an interactive workspace.

Output should be structured for scanning: executive summary, key findings, risks/gaps, and recommended next steps. Do not make legal advice the app default; for legal documents, frame analysis as informational and recommend qualified counsel for binding decisions.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "list_documents",
    "read_document",
    "find_in_document",
    "propose_docx_edits",
    "generate_xlsx",
  ],
  requiredToolProfiles: [...DOCS_PROFILE],
  requiredIntegrationIds: [],
};

export const DOCUMENT_DRAFTING_SKILL: SystemSkillSeedData = {
  slug: "document-drafting",
  name: "Document Drafting",
  summary: "Draft polished memos, letters, reports, proposals, and structured Word documents.",
  instructionsRaw: `# Document Drafting

Use this skill when the user wants a polished written deliverable.

Workflow:
1. Clarify audience, purpose, tone, and required format only when missing and material.
2. If source documents are in scope, read them before drafting and preserve citations for factual claims.
3. Use generate_docx when the user asks for a document, file, memo, letter, report, proposal, or downloadable draft.
4. Choose documentPurpose when obvious: memo, letter, report, brief, proposal, agreement, or checklist.
5. Use headings, tables, page breaks, appendices, and signature blocks only when they improve the deliverable.

After generating a document, briefly describe what was created and its structure. Do not put raw download links in prose; the app renders the document card.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["read_document", "generate_docx"],
  requiredToolProfiles: [...DOCS_PROFILE],
  requiredIntegrationIds: [],
};

export const CONTRACT_DRAFTING_SKILL: SystemSkillSeedData = {
  slug: "contract-drafting",
  name: "Contract Drafting",
  summary: "Draft business and legal agreements with conservative structure, clear definitions, and signature blocks.",
  instructionsRaw: `# Contract Drafting

Use this skill for drafting NDAs, MSAs, SOWs, service agreements, amendments, term sheets, and similar business/legal agreements.

Guidelines:
- This is informational drafting support, not legal advice.
- Use a conservative agreement structure: title, parties/effective date, recitals or background when useful, definitions, operative clauses, boilerplate, schedules/exhibits, signatures.
- Keep preambles and recitals unnumbered.
- Start operative provisions at Heading 1 and do not skip heading levels.
- Use definedTerms for important terms when the agreement has many definitions.
- Always include signatureBlocks for each party unless the user explicitly asks for a non-execution draft.
- Use generate_docx with documentPurpose: "agreement".

When source documents are attached, read them first and avoid inventing facts, parties, dates, commercial terms, or governing law.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["read_document", "generate_docx"],
  requiredToolProfiles: [...DOCS_PROFILE],
  requiredIntegrationIds: [],
};

export const LEGAL_MEMO_SKILL: SystemSkillSeedData = {
  slug: "legal-memo",
  name: "Legal Memo",
  summary: "Produce issue/rule/application/conclusion style legal memos from scoped documents or user facts.",
  instructionsRaw: `# Legal Memo

Use this skill when the user asks for a legal memo, issue memo, research memo, or structured legal analysis.

Workflow:
1. Identify the question presented and relevant jurisdiction if provided.
2. Read scoped documents before relying on them.
3. Use an Issue, Short Answer, Facts, Analysis, Conclusion structure unless the user requests another format.
4. Use citations for claims about scoped documents.
5. State uncertainty and assumptions clearly.
6. Use generate_docx with documentPurpose: "memo" when the user asks for a deliverable file.

Always include that the memo is informational and not a substitute for advice from qualified counsel.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["read_document", "find_in_document", "generate_docx"],
  requiredToolProfiles: [...DOCS_PROFILE],
  requiredIntegrationIds: [],
};

export const CLAUSE_EXTRACTION_SKILL: SystemSkillSeedData = {
  slug: "clause-extraction",
  name: "Clause Extraction",
  summary: "Extract clauses, terms, obligations, dates, and defined concepts from scoped documents with citations.",
  instructionsRaw: `# Clause Extraction

Use this skill for extracting clauses, terms, obligations, deadlines, restrictions, consent rights, termination rights, payment terms, liability caps, or defined terms.

Workflow:
1. Use list_documents if the target document is unclear.
2. Use find_in_document for targeted searches and read_document for surrounding context.
3. Return extracted content in a table when comparing several documents or clause categories.
4. Include exact quotes and citations for material extracted terms.
5. Do not infer a clause exists when the document is silent; state "not found" with the search basis when appropriate.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["list_documents", "read_document", "find_in_document"],
  requiredToolProfiles: [...DOCS_PROFILE],
  requiredIntegrationIds: [],
};

export const POLICY_REVIEW_SKILL: SystemSkillSeedData = {
  slug: "policy-review",
  name: "Policy Review",
  summary: "Review policy documents for consistency, risks, gaps, ambiguity, and implementation readiness.",
  instructionsRaw: `# Policy Review

Use this skill for internal policies, compliance policies, HR policies, security policies, and operating procedures.

Workflow:
1. Read the policy and any companion documents in scope.
2. Identify purpose, audience, obligations, owners, exceptions, escalation paths, review cadence, and enforcement mechanisms.
3. Flag ambiguity, internal inconsistency, missing controls, stale references, operational gaps, and user experience issues.
4. Provide a practical revision plan.
5. Use generate_docx with documentPurpose: "report" if the user asks for a formal review memo or revised policy document.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["read_document", "find_in_document", "generate_docx"],
  requiredToolProfiles: [...DOCS_PROFILE],
  requiredIntegrationIds: [],
};
