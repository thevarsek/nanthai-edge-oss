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
    "Analyze CSV, TSV, and XLSX data with notebook-style Python, export cleaned outputs, " +
    "and create native NanthAI charts with companion files.",
  instructionsRaw: `# Data Analyzer

Analyze tabular data to uncover patterns, trends, and actionable insights. Use NanthAI's Max analytics runtime to import files, run Python, create charts, and export cleaned outputs.

## Available Tools

- **workspace_import_file** — Import a user-owned file from NanthAI storage into the chat workspace.
- **data_python_exec** — Run notebook-style Python with pandas + matplotlib. Preferred path for analysis and charting.
- **workspace_export_file** — Export important workspace files back into durable NanthAI storage.

## Important Charting Rule

- When the user asks for charts, plots, or visual analysis, prefer **data_python_exec** over generic shell/runtime execution.
- NanthAI can render inline/native chart cards only from notebook-style Python chart output. Exported PNG files are companion downloads, not the primary chart path.
- Use exported PNGs and workbooks as supporting artifacts after the notebook output has already produced visible charts.

## When to Use

- Analyzing uploaded CSV, TSV, or XLSX files
- Exploring a dataset for patterns, outliers, or trends
- Creating summary statistics or pivot-table-style breakdowns
- Comparing data across time periods, categories, or segments
- Generating clean exports and chart outputs from raw data

## Analysis Workflow

### 1. Understand the Data
- Import the relevant file(s) into the workspace
- Use data_python_exec with pandas to inspect shape, columns, dtypes, null counts, and date ranges
- Report: file count, row/column dimensions, column names and types
- Identify the grain (what does each row represent?)
- Note any obvious issues: missing values, mixed types, inconsistent formats
- Ask clarifying questions if the data structure is ambiguous

### 2. Clean and Validate
- Check for missing values — how many, in which columns?
- Look for duplicates
- Validate ranges (negative revenue? future dates in historical data?)
- Flag any data quality issues before proceeding

### 3. Explore Patterns
- **Summary statistics:** count, min, max, mean, median for numeric columns
- **Distributions:** how are values spread? Any obvious skew or outliers?
- **Trends over time:** if there's a date column, how do metrics change?
- **Group comparisons:** break down metrics by category columns
- **Correlations:** do any numeric columns move together?
- **Outliers:** any values that are 3+ standard deviations from the mean?

### 4. Generate Insights
- Translate findings into plain-language observations
- Distinguish between facts ("Revenue increased 23% in Q3") and interpretations ("likely driven by the product launch")
- Rank insights by significance — lead with what matters most
- Note anything surprising or counter-intuitive

### 5. Present Findings
- Summarize key findings in a clear list
- Support each finding with specific numbers
- When charts help, use matplotlib inside data_python_exec so NanthAI can persist both chart images and native chart cards
- For visualization requests, do not fall back to workspace_exec or saved-only scripts unless data_python_exec is unavailable or clearly failing
- Export cleaned datasets, derived tables, and chart outputs for the user
- Recommend next steps or deeper analyses

## Runtime Guidance

- Prefer pandas for reading CSV / TSV / XLSX files.
- Prefer plain matplotlib for charts that should render natively in NanthAI.
- Prefer a direct notebook flow: load data, build one figure, call \`plt.tight_layout()\`, call \`plt.show()\`, then optionally \`fig.savefig(...)\` for durable exports.
- Save user-meaningful outputs to \`outputs/\` and export them.
- If the user uploaded a file, either:
  - import it first with workspace_import_file, then reference the workspace path in Python, or
  - pass it directly in data_python_exec.inputFiles.
- For chart-producing runs, keep the chart count focused. A few clear visuals are better than many noisy ones.
- For native NanthAI chart cards, prefer only these chart types:
  - line
  - bar
  - scatter
  - pie
  - box plot
- Avoid histogram-only, heatmap, pairplot, seaborn-only figure wrappers, and multi-axis composite charts when native chart cards matter.
- After creating each matplotlib chart, call \`plt.tight_layout()\` and then \`plt.show()\` so the chart appears in the notebook result stream.
- If you also need a durable file, save it after showing it, then export the PNG.
- When possible, create one chart per figure instead of combining multiple unrelated visuals into a single figure.
- If the user asked for multiple charts, render each one as its own shown figure so NanthAI can persist each chart cleanly.

## Common Analysis Types

### Summary Statistics
For each numeric column: count, mean, median, min, max, standard deviation. Flag columns with high variance or many missing values.

### Trend Analysis
Requires a date/time column. Calculate period-over-period changes (MoM, QoQ, YoY). Identify inflection points, seasonality, or sustained trends.

### Distribution Analysis
Histogram-style breakdown: what percentage of values fall in each range? Identify the shape (normal, skewed, bimodal). Highlight the long tail if present.

### Group Comparison
Break down a metric by a category column (e.g., revenue by region, conversion by channel). Calculate totals, averages, and shares for each group. Rank groups.

### Correlation
For pairs of numeric columns, assess whether they move together. Positive correlation, negative correlation, or no relationship. Caveat: correlation is not causation.

### Outlier Detection
Flag values that are unusually high or low. Use IQR method (below Q1 - 1.5*IQR or above Q3 + 1.5*IQR) or z-score > 3. List the outlier rows for review.

## Output Format

### Text Summary
**Dataset Overview**
- Source: [filename], [N] rows x [M] columns
- Time range: [start] to [end] (if applicable)
- Data quality: [clean / issues noted]

**Key Findings**
1. [Most important insight with supporting numbers]
2. [Second insight]
3. [Third insight]

**Data Quality Notes**
- [Missing values, duplicates, anomalies found]

**Recommended Next Steps**
- [What to investigate further, what decisions the data supports]

## Guidelines

- **Always start by reading the data.** Never assume structure — inspect it first.
- **Lead with insights, not methodology.** The user wants findings, not a statistics lecture.
- **Use plain language.** "Sales grew 15% quarter-over-quarter" not "the dependent variable exhibited a positive delta of 0.15 in the temporal dimension."
- **Be honest about limitations.** Small sample sizes, missing data, or confounding variables should be called out.
- **Don't over-interpret.** If the data doesn't clearly support a conclusion, say so.

## Data Profiling Checklist

When encountering a new dataset, run through this profiling checklist before diving into analysis:

- [ ] **Shape:** Row count, column count
- [ ] **Types:** Data types for each column (numeric, string, date, boolean)
- [ ] **Completeness:** Missing value count and percentage per column
- [ ] **Uniqueness:** Distinct values per column, identify potential keys
- [ ] **Distributions:** Min, max, mean, median, std for numeric columns
- [ ] **Top values:** Most frequent values for categorical columns
- [ ] **Date range:** Earliest and latest dates for temporal columns
- [ ] **Correlations:** Pairwise correlations for numeric columns (flag r > 0.7)
- [ ] **Outliers:** Flag values beyond 3 standard deviations or 1.5x IQR

## Statistical Test Quick Reference

When the user asks "is this significant?" or wants to compare groups, use the appropriate test:

| Question | Test | When to Use |
|----------|------|------------|
| Are these two averages different? | Independent t-test | Two independent groups, normal data |
| Are these two averages different? | Mann-Whitney U | Two independent groups, non-normal data |
| Did this metric change after an intervention? | Paired t-test | Before/after measurements on same subjects |
| Do three or more groups differ? | One-way ANOVA | Three+ independent groups, normal data |
| Is there a relationship between two variables? | Pearson correlation | Two continuous variables, linear relationship |
| Are these categories associated? | Chi-square test | Two categorical variables |

Always report: test statistic, p-value, effect size, and confidence interval. Explain results in plain language.

## Dashboard Layout Guidance

When creating multi-chart outputs:

- **KPI row on top:** 3-4 key metrics as large numbers with period-over-period change
- **Primary trend:** The most important metric over time, full width
- **Supporting charts:** 2-3 smaller charts (bar, pie, scatter) arranged in a grid
- **Use consistent colors** across all charts in the same output
- **One chart per figure** for NanthAI native rendering (each \`plt.show()\` creates a chart card)
- **For combined dashboards:** Use \`plt.subplots()\` grid, 16x10 figure size, \`tight_layout(pad=2.0)\`

## Quality Checklist

- [ ] Data was read and inspected before analysis began
- [ ] Data profiling checklist completed
- [ ] Data quality issues are documented
- [ ] Key findings are specific and supported by numbers
- [ ] Statistical claims include test name, p-value, and effect size
- [ ] Insights are ranked by importance
- [ ] Plain language is used throughout
- [ ] Limitations and caveats are noted
- [ ] Useful outputs are exported back into NanthAI storage
- [ ] Recommended next steps are included`,
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
