// convex/skills/catalog/xlsx.ts
// =============================================================================
// System skill: xlsx
// Adapted from .agents/skills/xlsx/SKILL.md for NanthAI runtime.
// NanthAI has generate_xlsx, read_xlsx, edit_xlsx tools.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const XLSX_SKILL: SystemSkillSeedData = {
  slug: "xlsx",
  name: "Spreadsheets",
  summary:
    "Create, read, edit, and manipulate Excel spreadsheets (.xlsx). Covers formulas, " +
    "cell formatting, number formats, merged cells, named ranges, and professional " +
    "spreadsheet structure. Use when working with .xlsx files, exports, review grids, or tabular data.",
  instructionsRaw: `# Spreadsheet (XLSX) Skill

Create, read, and edit Excel spreadsheets using NanthAI's document tools. If Max analytics runtime tools are available, prefer notebook-style Python for data cleaning, charting, and exploratory analysis, then use the spreadsheet tools for polished workbook output.

## Tools

- **generate_xlsx** — Create a new .xlsx with one or more worksheets
- **read_xlsx** — Extract data and structure from an existing .xlsx
- **edit_xlsx** — Replace content in an existing .xlsx (read → regenerate)
- **data_python_exec** — When available, use this for pandas-based analysis, cleaning, joins, pivots, and chart generation before exporting the final workbook or companion files.

## Max Analytics Guidance

- If the user asks for analysis, charting, or visualization, prefer **data_python_exec** first, then export the resulting workbook or chart files as companions.
- For charts that should appear inline in NanthAI, use plain matplotlib in **data_python_exec**, call \`plt.tight_layout()\`, then \`plt.show()\` for each figure before saving/exporting files.
- Do not rely on saved-only PNG exports as the primary visualization path when notebook chart output is available.

## Quick-Start Recipe

For most spreadsheets, just provide \`title\` and \`sheets\`. Headers get bold + dark blue styling automatically:

\`\`\`
generate_xlsx({
  title: "Q1 Sales Report",
  sheets: [{
    name: "Sales",
    headers: ["Month", "Revenue", "Units", "Avg Price"],
    rows: [
      ["January", 125000, 450, 277.78],
      ["February", 142000, 510, 278.43],
      ["March", 168000, 595, 282.35]
    ]
  }]
})
\`\`\`

Defaults: Bold dark-blue headers with white text, frozen top row, frozen first column, auto-sized column widths. You rarely need to override these.

## Cell Values

Pass the right type for each cell — the tool preserves types in Excel:
- **Numbers**: \`125000\` (stored as numeric — enables SUM, sorting, charts)
- **Strings**: \`"North America"\` (text)
- **Booleans**: \`true\` / \`false\`
- **Null**: \`null\` (empty cell)
- **Formulas**: \`"=SUM(B2:B10)"\` (string starting with \`=\`)

**Always pass numbers as numbers, not strings.** \`125000\` not \`"125000"\`. Numeric strings are auto-detected and converted, but explicit numbers are safer.

## Multiple Sheets

\`\`\`
generate_xlsx({
  title: "Financial Model",
  sheets: [
    { name: "Revenue", headers: [...], rows: [...] },
    { name: "Expenses", headers: [...], rows: [...] },
    { name: "Summary", headers: [...], rows: [...] }
  ]
})
\`\`\`

Sheet names: max 31 chars, no special chars (\`/ \\ ? * [ ]\`). Invalid chars are auto-replaced with \`_\`.

## When to Add Formatting

Only reach for optional params when the user explicitly asks or the spreadsheet type demands it:

| User request | What to add |
|---|---|
| "Format revenue as currency" | \`columnFormats: [{ column: 1, format: "$#,##0.00" }]\` |
| "Make totals row bold" | \`cellStyles: [{ range: "A12:D12", bold: true }]\` |
| "Color negative values red" | \`cellStyles: [{ range: "C2:C100", fontColor: "FF0000" }]\` |
| "Wider first column" | \`columnWidths: [25, 12, 12, 12]\` |
| "Merge the title row" | \`mergedCells: ["A1:D1"]\` |

## Number Formats

Apply number formats per-column (all data rows) or per-cell-range:

### Per-Column Format (columnFormats)
\`\`\`
columnFormats: [
  { column: 1, format: "$#,##0.00" },   // Column B = currency
  { column: 2, format: "#,##0" },        // Column C = thousands
  { column: 3, format: "0.0%" }          // Column D = percentage
]
\`\`\`

### Per-Cell Range (cellStyles with numberFormat)
\`\`\`
cellStyles: [
  { range: "E2:E50", numberFormat: "yyyy-mm-dd" }  // Date format for column E
]
\`\`\`

cellStyles override columnFormats when both apply to the same cell.

**Common format strings:**
| Format | Example output | Use for |
|---|---|---|
| \`$#,##0.00\` | $1,234.56 | Currency |
| \`#,##0\` | 1,235 | Whole numbers with thousands |
| \`0.0%\` | 12.3% | Percentages |
| \`0.00%\` | 12.34% | Precise percentages |
| \`yyyy-mm-dd\` | 2025-03-15 | Dates |
| \`#,##0.00\` | 1,234.56 | Decimal numbers |

## Cell Styling

Use \`cellStyles\` array on any sheet for visual formatting:

\`\`\`
cellStyles: [
  { range: "A1:D1", bold: true, bgColor: "2C3E50", fontColor: "FFFFFF" },  // Dark header
  { range: "D2:D100", fontColor: "27AE60" },                                // Green numbers
  { range: "A12:D12", bold: true, borderStyle: "medium" }                   // Bold totals with border
]
\`\`\`

| Style field | Values | Notes |
|---|---|---|
| bold | true/false | Bold text |
| fontColor | Hex RGB (no #) | e.g. "FF0000" for red |
| bgColor | Hex RGB (no #) | e.g. "FFFF00" for yellow |
| borderStyle | "thin", "medium", "thick" | All-sides border |
| numberFormat | Excel format string | See table above |

**Color palette for professional spreadsheets:**
- Headers: bgColor "2C3E50", fontColor "FFFFFF"
- Positive: fontColor "27AE60" (green)
- Negative: fontColor "E74C3C" (red)
- Warnings: fontColor "F39C12" (orange)
- Subtotals: bgColor "ECF0F1" (light gray)
- Input cells: bgColor "FFF9C4" (light yellow)

## Merged Cells

\`\`\`
mergedCells: ["A1:D1", "A8:A10"]
\`\`\`

Use sparingly — merged cells break sorting and filtering. Best for:
- Title rows spanning all columns
- Category labels spanning multiple rows

## Named Ranges

Define at the workbook level for formula references:

\`\`\`
generate_xlsx({
  title: "Budget",
  namedRanges: [
    { name: "Revenue", range: "Revenue!B2:B13" },
    { name: "Expenses", range: "Expenses!B2:B13" }
  ],
  sheets: [...]
})
\`\`\`

Named ranges let formulas reference data across sheets by name: \`=SUM(Revenue)\`.

## Column Widths

\`\`\`
columnWidths: [30, 15, 15, 12]
\`\`\`

Values are in character units (roughly the number of characters that fit). Auto-sized from content if omitted. Set explicit widths when:
- A column has long text that needs more space
- You want uniform column widths for a cleaner look

## Editing Spreadsheets

edit_xlsx uses a read → regenerate approach:

1. Use **read_xlsx** to understand the existing data (sheets, headers, rows, dimensions)
2. Call **edit_xlsx** with storageId + the full updated title/sheets
3. All formatting params from generate_xlsx are available on edit_xlsx too

The model must provide the complete sheet data — this is a full replacement, not a patch.

## Tabular Review Workflows

For document or data review grids, use a compact worksheet with stable columns for item, source, status, recommendation, owner, and notes. Keep review state values consistent across rows (for example pending, accepted, rejected, needs-review) so the client can render status chips predictably.

When the user asks to create an interactive tabular review workspace, do not substitute a static XLSX export for the workspace. Use the tabular review workflow/tooling when it exists. Use XLSX for import, analysis, export, or offline review-grid deliverables.

## Spreadsheet Type Recipes

### Budget / Financial Plan
- Sheets: Summary, Revenue, Expenses, Cash Flow, Assumptions
- columnFormats: currency for money columns, percentage for growth
- cellStyles: bold totals row, light yellow for input cells, light gray for subtotals
- Formulas: =SUM() for totals, cross-sheet references

### Project Tracker
- Sheet: Tasks
- Headers: Task, Owner, Status, Start Date, Due Date, % Complete
- columnFormats: dates for date columns, percentage for completion
- cellStyles: color-code Status column (green/yellow/red)

### Data Analysis
- Sheets: Raw Data, Clean Data, Analysis, Summary
- If Max analytics runtime is available, do heavy analysis in data_python_exec first, then export the cleaned/summary workbook with generate_xlsx or edit_xlsx
- Named ranges for key data areas
- Formulas: AVERAGE, COUNTIF, SUMIF for aggregations
- Keep raw data unmodified — calculations in separate sheet

### Invoice
- Single sheet, merged title row
- Headers: Description, Quantity, Rate, Amount
- Formulas: =B*C for line totals, =SUM() for subtotal
- cellStyles: bold header + total rows, currency format, company branding colors

## Best Practices

- **One purpose per sheet.** Don't mix data entry with calculations.
- **First row = headers.** Always. Bold and styled automatically.
- **Numbers as numbers.** Enables formulas, sorting, charts.
- **No merged cells in data ranges.** Breaks sorting/filtering.
- **Consistent formatting within columns.** Same number format, same alignment.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "anthropicCurated",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["generate_xlsx", "read_xlsx", "edit_xlsx"],
  requiredToolProfiles: ["docs", "analytics"],
  requiredIntegrationIds: [],
};
