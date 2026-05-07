// convex/skills/catalog/legal_contract_review.ts
// =============================================================================
// System skill: contract-review
// Structured contract analysis and NDA triage.
// Inspired by Anthropic knowledge-work-plugins/legal (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const CONTRACT_REVIEW_SKILL: SystemSkillSeedData = {
  slug: "contract-review",
  name: "Contract Review",
  summary:
    "Clause-by-clause contract analysis with risk flagging, NDA triage, and compliance checks. " +
    "Use when reviewing contracts, NDAs, service agreements, or any legal document for " +
    "risks, non-standard terms, negotiation points, redline-style change recommendations, credit agreement summaries, shareholder agreement summaries, or conditions precedent checklists.",
  instructionsRaw: `# Contract Review

Analyze contracts clause by clause, flag risks, identify non-standard terms, and provide actionable negotiation recommendations. This skill covers general contract review, NDA fast-triage, and compliance checks.

**Important disclaimer:** This analysis is for informational purposes only and does not constitute legal advice. Always consult with qualified legal counsel for binding legal decisions.

## When to Use

- Reviewing a new contract before signing
- Triaging NDAs for standard vs. non-standard terms
- Comparing contract terms against company standards
- Identifying risks and negotiation leverage points
- Preparing a summary for legal or executive review
- Checking compliance with specific regulatory requirements
- Preparing redline-style change recommendations or tracked-change proposals for a DOCX contract
- Summarizing credit agreements or shareholder agreements with cited key terms
- Drafting conditions precedent checklist requirements from financing documents

## Contract Review Workflow

### Step 1: Document Identification
- Identify the contract type (NDA, MSA, SaaS Agreement, Employment, SOW, etc.)
- Note the parties involved and their roles (who is obligated to whom)
- Check the effective date, term, and renewal provisions
- Identify the governing law and jurisdiction

### Step 2: Structural Assessment
- Is the contract well-organized with clear section numbering?
- Are all referenced exhibits, schedules, and appendices included?
- Are defined terms used consistently?
- Are there any blanks, TBD sections, or placeholder text?
- Is there an order of precedence clause (which document controls if conflicts)?

### Step 3: Clause-by-Clause Analysis

For each material clause, assess:

**Risk Level:** Low (standard/market) / Medium (slightly unfavorable) / High (significantly unfavorable) / Critical (deal-breaker or exposure)

**Key Clauses to Analyze:**

1. **Definitions** — Are key terms clearly defined? Are definitions overly broad or narrow?
2. **Scope of Work/Services** — Is the scope clearly defined? Are deliverables specific?
3. **Payment Terms** — Net terms, late fees, currency, price escalation, most-favored-nation?
4. **Term and Termination** — Duration, auto-renewal, termination for convenience, termination for cause, notice periods, wind-down obligations?
5. **Intellectual Property** — Who owns what? Work-for-hire provisions? License grants? Pre-existing IP carve-outs?
6. **Confidentiality** — Scope of confidential info, exclusions, duration, permitted disclosures, return/destruction obligations?
7. **Representations and Warranties** — What's being promised? Are warranties limited or disclaimed? Warranty period?
8. **Indemnification** — Who indemnifies whom? For what? Caps? Control of defense? Insurance requirements?
9. **Limitation of Liability** — Cap on damages? Exclusion of consequential/indirect damages? Carve-outs from the cap?
10. **Data Protection / Privacy** — DPA required? Data processing roles? Sub-processor consent? Breach notification timelines?
11. **Insurance** — Coverage types and minimums required? Certificate delivery obligations?
12. **Non-Compete / Non-Solicit** — Scope, duration, geography? Enforceability concerns?
13. **Force Majeure** — What events qualify? Notice requirements? Termination rights if prolonged?
14. **Dispute Resolution** — Litigation vs. arbitration? Venue? Prevailing party fees?
15. **Assignment** — Can either party assign? Change of control triggers?
16. **Governing Law** — Which state/country? Is it favorable or neutral?

### Step 4: NDA Fast-Triage (when applicable)

If the document is an NDA, run a fast-triage assessment:

| Element | Standard | This NDA | Flag? |
|---------|----------|----------|-------|
| Type | Mutual | Mutual/One-way | ⚠️ if one-way against you |
| Duration | 2-3 years | ? | ⚠️ if > 5 years or perpetual |
| Definition scope | Specifically marked info | ? | ⚠️ if "all information exchanged" |
| Exclusions | Standard 5 exclusions | ? | 🚩 if any missing |
| Residuals clause | Present | ? | ⚠️ if absent (favors discloser) |
| Non-solicit | Absent | ? | 🚩 if present in NDA |
| Injunctive relief | Mutual | ? | ⚠️ if one-sided |
| Return/destroy | On request or termination | ? | ⚠️ if only destroy (no return option) |
| Governing law | Neutral jurisdiction | ? | Note if unfavorable |

Standard NDA exclusions (all five should be present):
1. Publicly available information
2. Already known to recipient
3. Independently developed
4. Received from third party without restriction
5. Required by law/court order (with notice)

### Step 5: Risk Summary and Recommendations

Organize findings into:

**Critical Risks** (must address before signing):
- Issues that create significant legal exposure
- Missing standard protections
- One-sided clauses with no cap or recourse

**Negotiation Points** (should try to improve):
- Unfavorable but not deal-breaking terms
- Areas where market standard is better than what's offered
- Ambiguous language that could be interpreted against you

**Acceptable Terms** (standard/market):
- Clauses that are reasonable and well-drafted
- Terms that match or exceed expectations

## Output Format

### Contract Review: [Contract Type] — [Parties]

**Document:** [Title, date, version]
**Type:** [NDA / MSA / SaaS / SOW / Employment / Other]
**Parties:** [Party A] (the "[role]") and [Party B] (the "[role]")
**Governing Law:** [Jurisdiction]
**Term:** [Duration, renewal terms]

**Overall Risk Assessment:** Low / Medium / High / Critical

#### Risk Summary

| # | Clause | Risk | Issue | Recommendation |
|---|--------|------|-------|----------------|
| 1 | Limitation of Liability (§7) | 🔴 Critical | No cap on direct damages | Negotiate mutual cap (e.g., 12 months of fees) |
| 2 | IP Assignment (§4.2) | 🟡 Medium | Overly broad assignment of pre-existing IP | Add carve-out for pre-existing and independently developed IP |
| ... | ... | ... | ... | ... |

#### Detailed Analysis

[Clause-by-clause analysis following the framework above]

#### Recommended Actions

1. **Must fix:** [Critical items that need resolution]
2. **Should negotiate:** [Material terms worth pushing on]
3. **Accept as-is:** [Standard terms that are fine]
4. **Request clarification:** [Ambiguous areas needing definition]

**Disclaimer:** This analysis is for informational purposes only and does not constitute legal advice. Consult qualified legal counsel before making binding legal decisions.

## Redline and Tracked-Change Guidance

If the user asks for true Word tracked changes, use the DOCX tracked-change workflow when it is available. Keep the legal analysis in this contract-review skill, but let the tracked-change workflow own the actual accept/reject-able edit proposals. If tracked-change tooling is unavailable, produce a redline-style table with clause, current text, proposed replacement, reason, risk, and citation instead of claiming to modify the DOCX.

## Template and Review-Grid Guidance

Use these template modes when requested, while keeping factual claims tied to document citations:

- **Conditions precedent checklist:** Review the scoped credit agreement or financing document and produce a checklist grouped into practical categories such as Corporate, Financial, Legal, Security, Regulatory, Tax, and Miscellaneous. For a DOCX checklist, use landscape orientation when available and use four columns in this order: Index, Clause Number, Clause, Status. Number each row from 1 within its category and leave Status blank for user completion.
- **Credit agreement summary:** Cover lenders, borrowers, guarantors, material parties, date, facilities, total commitments, purpose, interest, commitment or utilization fees, repayment schedule, maturity, security, guarantees, financial covenants, events of default, assignment/transfer, change of control, prepayment fees, governing law, and dispute resolution where present. Flag unusual, onerous, missing, or non-market terms.
- **Shareholder agreement summary:** Cover parties, date, share classes, shareholdings, board composition, reserved matters, new-issue pre-emption rights, transfer restrictions, transfer pre-emption or ROFR, drag-along, tag-along, anti-dilution, dividends, exit/liquidity, deadlock, non-compete/non-solicit, confidentiality, warranties/indemnities, governing law, and dispute resolution where present.
- **Tabular review draft:** If the user asks for a review matrix or extraction grid, structure the answer as stable rows and columns that can later map to a tabular review workspace. Do not imply that cells have been generated in a workspace unless an explicit tabular review tool exists and has been used.

## Guidelines

- **Always include the disclaimer.** This is not legal advice.
- **Be specific about risk.** "§7.2 caps liability at $0 for the vendor" is actionable; "liability section needs work" is not.
- **Note what's missing, not just what's wrong.** A contract that's silent on IP ownership is a bigger risk than one with an imperfect IP clause.
- **Consider both sides.** Flag terms that are unfavorable to the user's position, but note when terms are market-standard even if not ideal.
- **Flag ambiguity.** Vague terms are litigation risks. If a clause could be read two ways, say so.
- **Don't over-flag.** Not every clause is a problem. Standard boilerplate that works fine should be noted as acceptable.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["list_documents", "read_document", "find_in_document"],
  requiredToolProfiles: ["docs"],
  requiredIntegrationIds: [],
};
