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
    "cell formatting, validation, bounded reads, preservation-aware edits, and professional " +
    "spreadsheet structure. Use when working with .xlsx files, exports, review grids, or tabular data.",
  instructionsRaw: `# Spreadsheet (XLSX) Skill

Create, read, and edit Excel spreadsheets using NanthAI's document tools. If Max analytics runtime tools are available, prefer notebook-style Python for data cleaning, charting, and exploratory analysis, then use the spreadsheet tools for polished workbook output.

## Tools

- **generate_xlsx** — Create a new .xlsx with one or more worksheets
- **read_xlsx** — Inspect one bounded sheet/range at a time, preserving formulas and typed values
- **edit_xlsx** — Patch targeted ranges while preserving unrelated OOXML; full rebuild remains an explicit fallback
- **data_python_exec** — When available, use this for pandas-based analysis, cleaning, joins, pivots, and chart generation before exporting the final workbook or companion files.

## Quick-Start Recipe

For most spreadsheets, just provide \`title\` and \`sheets\`. Headers get bold light-blue styling and borders automatically:

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

Defaults: Bold styled headers, frozen top row, auto-sized column widths, automatic recalculation on open, package validation, and a companion PDF preview when runtime context is available. Freeze left columns explicitly with freezeColumns.

## Cell Values

Pass the right type for each cell — the tool preserves types in Excel:
- **Numbers**: \`125000\` (stored as numeric — enables SUM, sorting, charts)
- **Strings**: \`"North America"\` (text; numeric-looking strings remain text)
- **Booleans**: \`true\` / \`false\`
- **Null**: \`null\` (empty cell)
- **Formulas**: \`"=SUM(B2:B10)"\` (string starting with \`=\`)
- **Explicit text identifiers**: \`{ type: "text", value: "00123" }\`
- **Dates**: \`{ type: "date", value: "2026-07-20" }\`
- **Formula with cached preview value**: \`{ type: "formula", formula: "SUM(B2:B10)", cachedValue: 42 }\`

**Always pass numbers as numbers, not strings.** \`125000\` not \`"125000"\`. Strings are never auto-converted because identifiers such as ZIP codes, SKUs, and account numbers must retain leading zeros.

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
| "Color negative values red" | \`conditionalFormats: [{ range: "C2:C100", operator: "lessThan", formula: "0", fontColor: "9C0006", bgColor: "FFC7CE" }]\` |
| "Wider first column" | \`columnWidths: [25, 12, 12, 12]\` |
| "Add status choices" | \`dataValidations: [{ range: "C2:C100", type: "list", formula1: '"Open,Closed"' }]\` |

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
| horizontalAlignment | "left", "center", "right" | Horizontal alignment |
| verticalAlignment | "top", "center", "bottom" | Vertical alignment |
| wrapText | true/false | Wrap long text in the cell |

## Conditional Formatting and Input Validation

Use \`conditionalFormats\` when the color depends on the cell's value; do not pre-color every cell based on today's values. Rules support \`greaterThan\`, \`lessThan\`, \`equal\`, \`notEqual\`, and \`between\` (with \`formula2\`).

Use \`dataValidations\` for list choices and whole-number, decimal, date, or text-length constraints. For a literal list, pass an Excel list string such as \`formula1: '"Open,Closed,Blocked"'\`. Use \`operator: "between"\` with \`formula1\` and \`formula2\` for bounded inputs.

For ordinary tables, set \`autoFilter\` to the used range and use \`freezeRows\` / \`freezeColumns\` for navigation. The default already freezes the header row.

Use sparingly — merged cells break sorting and filtering. Never merge the automatic header row or a sortable data range. Only merge intentionally blank presentation areas where the top-left cell is the sole value.

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

## Reading Large or Existing Spreadsheets

Start with a bounded read. Do not request an entire large workbook in one tool result:

\`\`\`
read_xlsx({
  storageId: "...",
  sheet: "Transactions",
  range: "A1:H5000",
  offset: 0,
  limit: 200,
  includeFormulas: true
})
\`\`\`

Use \`nextOffset\` while \`hasMore\` is true. Use \`search\` to filter matching rows server-side. Formula cells return formula text by default even when Excel stored a cached result; set \`includeFormulas: false\` only when cached displayed values are specifically needed.

## Editing Spreadsheets

Prefer preservation-aware patch operations:

1. Use **read_xlsx** with a bounded sheet/range to understand the target.
2. Call **edit_xlsx** with \`storageId\` and one or more operations.
3. Re-read the changed range to verify it.

\`\`\`
edit_xlsx({
  storageId: "...",
  title: "Updated Budget",
  operations: [
    { type: "setCells", sheet: "Budget", startCell: "B4", rows: [[125000, "=B4*0.2"]] },
    { type: "appendRows", sheet: "Budget", rows: [["New item", 5000]] }
  ]
})
\`\`\`

Supported operations are \`setCells\`, \`clearRange\`, \`appendRows\`, and \`renameSheet\`. They preserve unrelated workbook parts and existing styles on replaced cells. Use full \`sheets\` replacement only when the user explicitly asks to rebuild the workbook and accepts that unsupported original features may be replaced.

## Tabular Review Workflows

For document or data review grids, use a compact worksheet with stable columns for item, source, status, recommendation, owner, and notes. Keep review state values consistent across rows (for example pending, accepted, rejected, needs-review) so the client can render status chips predictably.

For bounded document comparisons, follow the document-review skill's separate scope confirmation and source-citation rules, then create the complete result with generate_xlsx. The comparison remains in the ordinary chat and generated-file flow; do not claim to create an interactive workspace.

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
- dataValidations: constrain Status to a stable list
- conditionalFormats: color numeric risk or overdue indicators dynamically

### Data Analysis
- Sheets: Raw Data, Clean Data, Analysis, Summary
- If Max analytics runtime is available, do heavy analysis in data_python_exec first, then export the cleaned/summary workbook with generate_xlsx or edit_xlsx
- Named ranges for key data areas
- Formulas: AVERAGE, COUNTIF, SUMIF for aggregations
- Keep raw data unmodified — calculations in separate sheet

## Best Practices

- **One purpose per sheet.** Don't mix data entry with calculations.
- **First row = headers.** Always. Bold and styled automatically.
- **Numbers as numbers.** Enables formulas, sorting, charts.
- **No merged cells in data ranges.** Breaks sorting/filtering.
- **Consistent formatting within columns.** Same number format, same alignment.
- **Filter tables and freeze navigation anchors.** Use autoFilter and freeze panes on long sheets.
- **Validate before handoff.** Generated and edited workbooks return deterministic package QA; use the companion PDF for a quick visual check when available.`,
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
