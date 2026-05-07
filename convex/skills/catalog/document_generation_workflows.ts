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
    "Review scoped documents with quote-backed citations, issue spotting, concise recommendations, redline-style change lists, and structured review-grid/table outlines when requested.",
  instructionsRaw: `# Document Review

Use this skill when the user asks to review, summarize, critique, compare, or risk-check one or more scoped documents.

Workflow:
1. Use list_documents when the document set is unclear.
2. Use read_document for the relevant document text.
3. Use find_in_document for targeted clauses, defined terms, dates, obligations, or suspected issues.
4. Cite document-specific claims with the existing document citation rules.
5. Separate facts from recommendations.
6. If the user asks for true DOCX tracked changes, use the DOCX/tracked-change workflow when available rather than treating a review memo as an edited document. Without that tool, return a redline-style issue/change list with quotes, reasons, and recommended replacement wording.
7. If the user asks for a review matrix, extraction grid, or tabular review draft, structure the response as stable rows and columns that can later map to the M38 tabular review workspace. Do not imply that cells have been generated in a workspace unless an explicit tabular review tool exists and has been used.

Output should be structured for scanning: executive summary, key findings, risks/gaps, and recommended next steps. Do not make legal advice the app default; for legal documents, frame analysis as informational and recommend qualified counsel for binding decisions.`,
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

export const CONDITIONS_PRECEDENT_CHECKLIST_SKILL: SystemSkillSeedData = {
  slug: "conditions-precedent-checklist",
  name: "Conditions Precedent Checklist",
  summary:
    "Template-like workflow for generating a landscape DOCX conditions precedent checklist from financing documents; a future tabular review template candidate.",
  instructionsRaw: `# Conditions Precedent Checklist

This is a template-like workflow inspired by Mike's "Generate CP Checklist" assistant workflow.

When loaded, review the scoped credit agreement or financing document and generate a comprehensive conditions precedent checklist as a Word document.

Requirements:
- Use read_document first.
- Use generate_docx; do not display the checklist only inline.
- Set documentPurpose: "checklist" and landscape: true.
- Organize conditions into practical categories such as Corporate, Financial, Legal, Security, Regulatory, Tax, and Miscellaneous.
- Each category should be a section with a table.
- Each table must use exactly four columns in this order: Index, Clause Number, Clause, Status.
- Number each row from 1 within its category.
- Leave Status blank for user completion.
- Cite source provisions in the prose summary when describing what was generated.`,
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

export const CREDIT_AGREEMENT_SUMMARY_SKILL: SystemSkillSeedData = {
  slug: "credit-agreement-summary",
  name: "Credit Agreement Summary",
  summary:
    "Template-like workflow for summarizing core credit-agreement terms; a future tabular review-grid preset candidate.",
  instructionsRaw: `# Credit Agreement Summary

This is a template-like workflow inspired by Mike's "Credit Agreement Summary" assistant workflow.

Review the scoped credit agreement and produce a comprehensive summary. Use read_document and find_in_document as needed. Deliver inline unless the user explicitly asks for a Word document.

If the user asks for a review matrix or extraction grid, structure the answer as stable rows/columns that can later map to a tabular review workspace. Do not imply that cells have been generated in a workspace unless an explicit tabular review tool exists and has been used.

Cover these topics where present: lenders, borrowers, guarantors, other material parties, date, facilities, total commitments, purpose, interest, commitment or utilization fees, repayment schedule, maturity, security, guarantees, financial covenants, events of default, assignment/transfer, change of control, prepayment fees, governing law, and dispute resolution.

For each section, identify key provisions, quote relevant clause or schedule references where useful, and flag unusual, onerous, missing, or non-market terms. Use document citations for factual claims.`,
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

export const SHAREHOLDER_AGREEMENT_SUMMARY_SKILL: SystemSkillSeedData = {
  slug: "shareholder-agreement-summary",
  name: "Shareholder Agreement Summary",
  summary:
    "Template-like workflow for summarizing shareholder-agreement terms; a future tabular review-grid preset candidate.",
  instructionsRaw: `# Shareholder Agreement Summary

This is a template-like workflow inspired by Mike's "Shareholder Agreement Summary" assistant workflow.

Review the scoped shareholder agreement and produce a structured summary. Use read_document and find_in_document as needed. Deliver inline unless the user explicitly asks for a Word document.

If the user asks for a review matrix or extraction grid, structure the answer as stable rows/columns that can later map to a tabular review workspace. Do not imply that cells have been generated in a workspace unless an explicit tabular review tool exists and has been used.

Cover these topics where present: parties, date, share classes, shareholdings, board composition, reserved matters, new-issue pre-emption rights, transfer restrictions, transfer pre-emption or ROFR, drag-along, tag-along, anti-dilution, dividends, exit/liquidity, deadlock, non-compete/non-solicit, confidentiality, warranties/indemnities, governing law, and dispute resolution.

Quote and cite source text for material provisions. Distinguish what the document states from practical risk commentary.`,
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
