// convex/skills/catalog/data_validation.ts
// =============================================================================
// System skill: data-validation
// Data quality checks, completeness audits, referential integrity.
// MAX-only sandbox skill.
// Inspired by Anthropic knowledge-work-plugins/data (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DATA_VALIDATION_SKILL: SystemSkillSeedData = {
  slug: "data-validation",
  name: "Data Validation",
  summary:
    "Run systematic data quality checks: completeness, consistency, format validation, " +
    "duplicate detection, referential integrity, and outlier flagging. Use when auditing " +
    "a dataset for quality issues before analysis or import.",
  instructionsRaw: `# Data Validation & Quality Audit

Run systematic data quality checks on uploaded datasets. Detect missing values, duplicates, format violations, referential integrity failures, outliers, and consistency issues. Produce a data quality report with actionable findings.

## Available Tools

- **workspace_import_file** — Import a user-owned file from NanthAI storage into the chat workspace.
- **data_python_exec** — Run Python with pandas for validation checks and reporting.
- **workspace_export_file** — Export quality reports and cleaned data back to NanthAI storage.

## When to Use

- Auditing data quality before analysis or reporting
- Validating data before importing into a production system
- Checking for duplicates, missing values, or format issues
- Verifying referential integrity across related tables
- Profiling an unfamiliar dataset to understand its quality
- Cleaning and standardizing messy data

## Data Quality Dimensions

### 1. Completeness
Are all expected values present?

\`\`\`python
import pandas as pd

df = pd.read_csv("inputs/data.csv")

# Missing value summary
missing = df.isnull().sum()
missing_pct = (missing / len(df) * 100).round(2)
missing_report = pd.DataFrame({
    "column": df.columns,
    "missing_count": missing.values,
    "missing_pct": missing_pct.values,
    "dtype": df.dtypes.values
}).sort_values("missing_pct", ascending=False)
print(missing_report[missing_report["missing_count"] > 0].to_string(index=False))
\`\`\`

**Thresholds:**
- 0% missing: Excellent
- <5% missing: Acceptable (depending on column)
- 5-20% missing: Investigate — is the data truly missing or a collection issue?
- >20% missing: Column may not be reliable for analysis

### 2. Uniqueness (Duplicate Detection)
Are there duplicate records?

\`\`\`python
# Exact duplicates
exact_dupes = df.duplicated().sum()
print(f"Exact duplicate rows: {exact_dupes}")

# Duplicates on key columns
key_cols = ["email", "customer_id"]  # adjust to actual keys
key_dupes = df.duplicated(subset=key_cols, keep=False)
print(f"Duplicate keys: {key_dupes.sum()} rows ({df[key_dupes][key_cols].nunique().to_dict()})")

# Show duplicate groups
if key_dupes.sum() > 0:
    print(df[key_dupes].sort_values(key_cols).head(20))
\`\`\`

### 3. Validity (Format & Range Checks)
Do values conform to expected formats and ranges?

\`\`\`python
import re

# Email format validation
email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
invalid_emails = df[~df["email"].str.match(email_pattern, na=False)]

# Date range validation
df["date"] = pd.to_datetime(df["date"], errors="coerce")
future_dates = df[df["date"] > pd.Timestamp.now()]
ancient_dates = df[df["date"] < pd.Timestamp("2000-01-01")]

# Numeric range validation
negative_revenue = df[df["revenue"] < 0]
extreme_values = df[df["revenue"] > df["revenue"].quantile(0.999)]

# Categorical validation (allowed values)
valid_statuses = ["active", "inactive", "pending", "cancelled"]
invalid_status = df[~df["status"].isin(valid_statuses)]
\`\`\`

### 4. Consistency
Do related fields agree with each other?

\`\`\`python
# Cross-field consistency
# Example: end_date should be after start_date
inconsistent_dates = df[df["end_date"] < df["start_date"]]

# Example: total should equal quantity * unit_price
df["expected_total"] = df["quantity"] * df["unit_price"]
total_mismatches = df[abs(df["total"] - df["expected_total"]) > 0.01]

# Example: state/zip code consistency
# (would need a lookup table)
\`\`\`

### 5. Referential Integrity
Do foreign keys point to valid records?

\`\`\`python
# Check that all customer_ids in orders exist in customers
orders = pd.read_csv("inputs/orders.csv")
customers = pd.read_csv("inputs/customers.csv")

orphan_orders = orders[~orders["customer_id"].isin(customers["customer_id"])]
print(f"Orphan orders (no matching customer): {len(orphan_orders)}")
\`\`\`

### 6. Accuracy (Statistical Outliers)
Are there values that seem wrong?

\`\`\`python
import numpy as np

# Z-score method
for col in df.select_dtypes(include=[np.number]).columns:
    z_scores = np.abs((df[col] - df[col].mean()) / df[col].std())
    outliers = (z_scores > 3).sum()
    if outliers > 0:
        print(f"{col}: {outliers} outliers (z > 3)")

# IQR method
for col in df.select_dtypes(include=[np.number]).columns:
    Q1, Q3 = df[col].quantile([0.25, 0.75])
    IQR = Q3 - Q1
    lower = Q1 - 1.5 * IQR
    upper = Q3 + 1.5 * IQR
    outliers = ((df[col] < lower) | (df[col] > upper)).sum()
    if outliers > 0:
        print(f"{col}: {outliers} outliers (IQR method), range [{lower:.2f}, {upper:.2f}]")
\`\`\`

## Data Quality Report Template

### Data Quality Report: [Dataset Name]

**Dataset:** [filename], [N] rows x [M] columns
**Date audited:** [date]
**Overall quality score:** [X/100]

**Summary:**
| Dimension | Score | Issues Found | Severity |
|-----------|-------|-------------|----------|
| Completeness | X/100 | [N] columns with missing data | [High/Med/Low] |
| Uniqueness | X/100 | [N] duplicate records | [High/Med/Low] |
| Validity | X/100 | [N] format/range violations | [High/Med/Low] |
| Consistency | X/100 | [N] cross-field conflicts | [High/Med/Low] |
| Referential integrity | X/100 | [N] orphan records | [High/Med/Low] |
| Accuracy | X/100 | [N] statistical outliers | [High/Med/Low] |

**Critical Issues (must fix):**
1. [Issue with count and affected columns/rows]

**Warnings (should review):**
1. [Issue with count and affected columns/rows]

**Informational:**
1. [Observation about data patterns]

**Recommended Actions:**
| Priority | Action | Rows Affected | Effort |
|----------|--------|--------------|--------|
| P0 | Remove exact duplicate rows | [N] | Low |
| P0 | Fix orphan foreign keys | [N] | Medium |
| P1 | Impute/remove missing values in [column] | [N] | Medium |
| P2 | Standardize [column] format | [N] | Low |

## Quality Score Calculation

\`\`\`python
# Simple weighted quality score
weights = {
    "completeness": 0.25,
    "uniqueness": 0.20,
    "validity": 0.20,
    "consistency": 0.15,
    "referential": 0.10,
    "accuracy": 0.10,
}

# Per-dimension score: 100 * (1 - error_rate)
# completeness_score = 100 * (1 - total_missing / total_cells)
# uniqueness_score = 100 * (1 - duplicate_rows / total_rows)
# etc.

# overall = sum(score * weight for score, weight in zip(scores, weights))
\`\`\`

## Guidelines

- **Profile before validating.** Understand the data's structure and purpose before deciding what counts as an error.
- **Define "correct" with the user.** What's valid depends on context — a negative value might be an error in revenue but correct for adjustments.
- **Quantify everything.** "Some missing data" is useless. "Column X has 1,234 missing values (8.2%)" is actionable.
- **Prioritize by impact.** A duplicate primary key is more serious than a missing optional field.
- **Show examples.** Don't just count errors — show the actual bad rows so the user can verify they're truly errors.
- **Export flagged rows.** Create a "flagged records" output file with error codes for easy remediation.
- **Don't auto-fix without permission.** Report findings and recommend fixes, but let the user decide before modifying data.`,
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
  requiredCapabilities: ["sandboxRuntime"],
};
