// convex/skills/catalog/finance_reconciliation.ts
// =============================================================================
// System skill: reconciliation
// Account reconciliation with matching and discrepancy identification.
// MAX-only sandbox skill.
// Inspired by Anthropic knowledge-work-plugins/finance (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const RECONCILIATION_SKILL: SystemSkillSeedData = {
  slug: "reconciliation",
  name: "Reconciliation",
  summary:
    "Reconcile accounts by matching transactions across two data sources, identifying " +
    "discrepancies, and producing exception reports. Use for bank reconciliation, " +
    "intercompany matching, or ledger-to-subledger comparison.",
  instructionsRaw: `# Account Reconciliation

Match transactions across two data sources to identify discrepancies, unmatched items, and timing differences. Supports bank reconciliation, intercompany matching, ledger-to-subledger comparison, and vendor statement reconciliation.

## Available Tools

- **workspace_import_file** — Import files from NanthAI storage into the workspace.
- **data_python_exec** — Run Python with pandas for matching logic and reporting.
- **workspace_export_file** — Export reconciliation reports and exception files.

## When to Use

- Reconciling bank statements against internal records
- Matching invoices to payments
- Comparing general ledger to subledger balances
- Intercompany transaction matching
- Vendor statement reconciliation
- Any scenario where two datasets should agree but may not

## Reconciliation Workflow

### 1. Load and Inspect Both Sources

\`\`\`python
import pandas as pd

# Load the two datasets
source_a = pd.read_csv("inputs/internal_ledger.csv")
source_b = pd.read_csv("inputs/bank_statement.csv")

print(f"Source A (Internal): {len(source_a)} transactions")
print(f"Source B (Bank):     {len(source_b)} transactions")
print(f"Source A total: \${source_a['amount'].sum():,.2f}")
print(f"Source B total: \${source_b['amount'].sum():,.2f}")
print(f"Difference:     \${source_a['amount'].sum() - source_b['amount'].sum():,.2f}")
\`\`\`

### 2. Standardize and Prepare

Before matching, standardize both datasets:

\`\`\`python
# Standardize date formats
source_a["date"] = pd.to_datetime(source_a["date"])
source_b["date"] = pd.to_datetime(source_b["date"])

# Standardize amount signs (ensure same convention)
# Normalize reference numbers (strip whitespace, uppercase)
source_a["ref"] = source_a["reference"].str.strip().str.upper()
source_b["ref"] = source_b["reference"].str.strip().str.upper()

# Round amounts to avoid floating-point mismatches
source_a["amount"] = source_a["amount"].round(2)
source_b["amount"] = source_b["amount"].round(2)
\`\`\`

### 3. Match Transactions

**Matching strategies (apply in order of strictness):**

**Level 1: Exact match on reference + amount**
\`\`\`python
matched_l1 = pd.merge(
    source_a, source_b,
    on=["ref", "amount"],
    how="inner",
    suffixes=("_internal", "_bank")
)
\`\`\`

**Level 2: Match on amount + date (within tolerance)**
\`\`\`python
# For unmatched items from Level 1
unmatched_a = source_a[~source_a.index.isin(matched_l1.index)]
unmatched_b = source_b[~source_b.index.isin(matched_l1.index)]

# Date tolerance: within 3 business days
from datetime import timedelta
date_tolerance = timedelta(days=3)

matched_l2 = []
for _, row_a in unmatched_a.iterrows():
    candidates = unmatched_b[
        (unmatched_b["amount"] == row_a["amount"]) &
        (abs(unmatched_b["date"] - row_a["date"]) <= date_tolerance)
    ]
    if len(candidates) == 1:
        matched_l2.append((row_a.name, candidates.index[0]))
\`\`\`

**Level 3: Fuzzy match (amount tolerance + partial reference)**
\`\`\`python
# Amount tolerance: within $0.10 (for rounding differences)
amount_tolerance = 0.10

# Apply to remaining unmatched items
\`\`\`

### 4. Classify Results

Every transaction should be classified:

| Category | Description | Action |
|----------|-------------|--------|
| **Matched** | Found in both sources, amounts agree | No action |
| **Matched (timing)** | Same transaction, different dates | Note timing difference |
| **Matched (variance)** | Same transaction, small amount difference | Investigate variance |
| **Unmatched — Source A only** | In internal records but not bank | Pending clearance or error |
| **Unmatched — Source B only** | In bank but not internal records | Missing booking or bank error |
| **One-to-many** | One transaction in A matches multiple in B | Possible split or partial payments |

### 5. Produce Reconciliation Report

\`\`\`python
# Summary
print("=== RECONCILIATION SUMMARY ===")
print(f"Source A total:          \${total_a:>12,.2f}")
print(f"Source B total:          \${total_b:>12,.2f}")
print(f"Gross difference:        \${total_a - total_b:>12,.2f}")
print()
print(f"Matched (exact):         {len(matched_l1):>6} items  \${matched_l1_total:>12,.2f}")
print(f"Matched (timing):        {len(matched_l2):>6} items  \${matched_l2_total:>12,.2f}")
print(f"Unmatched (Source A):     {len(unmatched_a_final):>6} items  \${unmatched_a_total:>12,.2f}")
print(f"Unmatched (Source B):     {len(unmatched_b_final):>6} items  \${unmatched_b_total:>12,.2f}")
print()
print(f"Explained difference:    \${explained:>12,.2f}")
print(f"Unexplained difference:  \${unexplained:>12,.2f}")
\`\`\`

## Reconciliation Report Template

### Account Reconciliation: [Account Name]

**Period:** [Start date] to [End date]
**Prepared by:** [Name]
**Date prepared:** [Date]

**Balance per Source A (Internal):** $X,XXX,XXX.XX
**Balance per Source B (Bank/Vendor):** $X,XXX,XXX.XX
**Difference:** $X,XXX.XX

**Reconciling Items:**

| # | Description | Amount | Category | Status |
|---|------------|--------|----------|--------|
| 1 | Deposit in transit (ref: 12345) | $5,000.00 | Timing | Expected to clear [date] |
| 2 | Outstanding check #4567 | ($2,300.00) | Timing | Issued [date] |
| 3 | Bank fee not yet recorded | ($45.00) | Missing booking | Needs journal entry |
| 4 | Unidentified bank credit | $1,200.00 | Unmatched | Needs investigation |

**Adjusted Balance per Source A:** $X,XXX,XXX.XX
**Adjusted Balance per Source B:** $X,XXX,XXX.XX
**Remaining difference:** $0.00 (or $X.XX with explanation)

## Export Files

Produce these outputs:
1. **reconciliation_summary.csv** — High-level summary with totals
2. **matched_transactions.csv** — All matched pairs with match level
3. **unmatched_source_a.csv** — Items in A not found in B
4. **unmatched_source_b.csv** — Items in B not found in A
5. **exceptions.csv** — Items requiring manual review (amount variances, one-to-many)

## Guidelines

- **Standardize before matching.** Different date formats, reference conventions, and amount signs cause false mismatches.
- **Match in layers.** Start with strict criteria (exact match), then progressively relax (date tolerance, amount tolerance, fuzzy).
- **Every item must be classified.** No transaction should be left unaccounted for.
- **Quantify the unexplained.** The goal is to drive the unexplained difference to zero or to a known, immaterial threshold.
- **Show your work.** For each reconciling item, explain why it doesn't match and what action is needed.
- **Export everything.** The user needs exception files they can work through, not just a summary.
- **Flag aged items.** Unmatched items older than 30/60/90 days deserve extra attention.
- **Respect materiality.** A $0.01 rounding difference is not the same as a $10,000 missing payment. Focus effort accordingly.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "sandboxAugmented",
  requiredToolIds: ["workspace_import_file", "data_python_exec", "workspace_export_file"],
  requiredToolProfiles: ["analytics"],
  requiredIntegrationIds: [],
};
