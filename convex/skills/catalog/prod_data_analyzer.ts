// convex/skills/catalog/prod_data_analyzer.ts
// =============================================================================
// System skill: data-analyzer
// Original NanthAI skill for spreadsheet data analysis and insights.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DATA_ANALYZER_SKILL: SystemSkillSeedData = {
  slug: "data-analyzer",
  name: "Data Analyzer",
  summary:
    "Run Python code to analyze data, create charts and graphs (bar, line, pie, scatter), " +
    "plot visualizations with matplotlib, process CSV/TSV/XLSX files, and export cleaned outputs.",
  instructionsRaw: `# Data Analyzer

Analyze tabular data, create charts, explain findings, and export cleaned or derived outputs. Use NanthAI's analytics runtime as the primary path for CSV, TSV, XLSX, JSON tables, and similar structured data.

## Tools

- **workspace_import_file**: import user-owned files into the chat workspace before analysis.
- **data_python_exec**: preferred notebook-style Python runtime with pandas, numpy, and matplotlib. Use first for inspection, ordinary analysis, and charting.
- **data_python_sandbox**: persistent Linux Python sandbox. Use when data_python_exec fails because of package, memory, or timeout limits.
- **workspace_export_file**: export important workspace files back into durable NanthAI storage.

## Non-Negotiables

- Always analyze the complete uploaded file, not truncated inline preview text.
- Import files with **workspace_import_file** or pass storage IDs through data_python_exec/data_python_sandbox input files so data is available under \`/tmp/inputs/\`.
- Save user-meaningful output files to \`/tmp/outputs/\`; NanthAI auto-captures this directory as downloadable artifacts.
- Prefer **data_python_exec** for charts because shown matplotlib figures can become native chart cards.
- For chart runs, call \`plt.tight_layout()\` and \`plt.show()\`. Save a durable PNG to \`/tmp/outputs/\` only when a file artifact is useful.
- Do not retry the same failing data_python_exec code more than once. Escalate to data_python_sandbox on package, memory, or timeout failures.

## Workflow

1. Inspect the data.
   - Load each relevant file with pandas.
   - Report rows, columns, data types, date ranges, and likely grain.
   - Check missing values, duplicates, mixed types, suspicious ranges, and obvious outliers.
   - Ask a clarifying question when the grain, metric definitions, or target decision is ambiguous.

2. Clean and validate.
   - Normalize dates, numeric strings, category labels, and duplicate rows when appropriate.
   - Preserve raw values unless the user asked for destructive cleaning.
   - Document assumptions and data quality issues before drawing conclusions.

3. Analyze.
   - Use summary statistics for numeric fields.
   - Compare groups by category.
   - Analyze time trends when there is a date/time field.
   - Check distributions, correlations, and outliers when relevant.
   - Use statistical tests only when the question needs significance, and report the test, p-value, effect size, confidence interval, and caveats.

4. Visualize.
   - Use simple matplotlib charts: line, bar, scatter, pie, or box plot.
   - Prefer one clear chart per figure so NanthAI can capture each chart cleanly.
   - Avoid noisy dashboards, unrelated multi-axis composites, and decorative charts.

5. Present results.
   - Lead with findings, not methodology.
   - Support each finding with concrete numbers.
   - Separate factual observations from interpretations.
   - Call out limitations such as small samples, missing data, or confounding variables.
   - Recommend focused next steps or decisions the data supports.

## Output Format

Use this structure unless the user asked for another format:

**Dataset Overview**
- Source: filename(s)
- Shape: N rows x M columns
- Time range: start to end, if applicable
- Data quality: clean or issues noted

**Key Findings**
1. Most important insight with supporting numbers
2. Second insight
3. Third insight

**Data Quality Notes**
- Missing values, duplicates, anomalies, or assumptions

**Artifacts**
- Cleaned datasets, derived tables, workbooks, or chart files saved to \`/tmp/outputs/\`

**Recommended Next Steps**
- Follow-up analyses, decisions, or checks

## Quick References

- Summary statistics: count, mean, median, min, max, standard deviation, missing count.
- Trend analysis: period-over-period changes, inflection points, seasonality, sustained shifts.
- Group comparison: totals, averages, shares, rank order, practical difference.
- Correlation: direction and strength; never imply causation from correlation alone.
- Outliers: use IQR or z-score, list affected rows for review.
- Significance: t-test, Mann-Whitney U, paired t-test, ANOVA, Pearson correlation, or chi-square depending on the data and question.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "sandboxAugmented",
  requiredToolIds: ["workspace_import_file", "data_python_exec", "data_python_sandbox", "workspace_export_file"],
  requiredToolProfiles: ["analytics"],
  requiredIntegrationIds: [],
};
