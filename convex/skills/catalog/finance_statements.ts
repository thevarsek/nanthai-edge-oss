// convex/skills/catalog/finance_statements.ts
// =============================================================================
// System skill: financial-statements
// Income statements, balance sheets, cash flow, and variance analysis.
// toolAugmented — uses spreadsheet tools for output.
// Inspired by Anthropic knowledge-work-plugins/finance (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const FINANCIAL_STATEMENTS_SKILL: SystemSkillSeedData = {
  slug: "financial-statements",
  name: "Financial Statements",
  summary:
    "Build and analyze income statements, balance sheets, cash flow statements, and " +
    "variance analysis. Use when the user needs financial modeling, budget-vs-actual " +
    "comparisons, or formatted financial reports.",
  instructionsRaw: `# Financial Statements & Analysis

Build, analyze, and format financial statements: income statements, balance sheets, cash flow statements, budget-vs-actual comparisons, and variance analysis. Produce clean spreadsheet outputs suitable for review by finance teams, investors, or executives.

## Available Tools

Use spreadsheet tools (generate_xlsx, read_xlsx, edit_xlsx) for formatted workbook output. If Max analytics runtime is available, use data_python_exec for calculations and then export to xlsx.

## When to Use

- Building an income statement (P&L) from raw data
- Creating a balance sheet from account balances
- Constructing a cash flow statement
- Performing budget-vs-actual variance analysis
- Building financial models or projections
- Formatting financial data for board reports or investor updates

## Financial Statement Templates

### Income Statement (P&L)

\`\`\`
                            Current Period    Prior Period    Change      Change %
Revenue
  Product revenue              $X,XXX,XXX     $X,XXX,XXX    $XXX,XXX      XX.X%
  Service revenue              $X,XXX,XXX     $X,XXX,XXX    $XXX,XXX      XX.X%
  Other revenue                  $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
Total Revenue                  $X,XXX,XXX     $X,XXX,XXX    $XXX,XXX      XX.X%

Cost of Goods Sold
  Direct materials               $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
  Direct labor                   $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
  Manufacturing overhead         $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
Total COGS                       $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%

Gross Profit                   $X,XXX,XXX     $X,XXX,XXX    $XXX,XXX      XX.X%
Gross Margin                       XX.X%          XX.X%

Operating Expenses
  Sales & marketing              $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
  Research & development         $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
  General & administrative       $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
Total Operating Expenses         $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%

Operating Income (EBIT)          $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
Operating Margin                     XX.X%          XX.X%

Interest expense                  ($XX,XXX)      ($XX,XXX)     ($X,XXX)     XX.X%
Other income (expense)             $XX,XXX        $XX,XXX       $X,XXX      XX.X%

Income Before Tax                $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
Income tax provision              ($XX,XXX)      ($XX,XXX)     ($X,XXX)     XX.X%

Net Income                       $XXX,XXX       $XXX,XXX      $XX,XXX      XX.X%
Net Margin                           XX.X%          XX.X%
\`\`\`

### Balance Sheet

\`\`\`
                                Current Date    Prior Date
ASSETS
Current Assets
  Cash and equivalents           $XXX,XXX       $XXX,XXX
  Accounts receivable            $XXX,XXX       $XXX,XXX
  Inventory                      $XXX,XXX       $XXX,XXX
  Prepaid expenses                $XX,XXX        $XX,XXX
Total Current Assets           $X,XXX,XXX     $X,XXX,XXX

Non-Current Assets
  Property, plant & equipment    $XXX,XXX       $XXX,XXX
  Intangible assets              $XXX,XXX       $XXX,XXX
  Goodwill                       $XXX,XXX       $XXX,XXX
  Other long-term assets          $XX,XXX        $XX,XXX
Total Non-Current Assets       $X,XXX,XXX     $X,XXX,XXX

TOTAL ASSETS                   $X,XXX,XXX     $X,XXX,XXX

LIABILITIES
Current Liabilities
  Accounts payable               $XXX,XXX       $XXX,XXX
  Accrued expenses               $XXX,XXX       $XXX,XXX
  Short-term debt                $XXX,XXX       $XXX,XXX
  Deferred revenue               $XXX,XXX       $XXX,XXX
Total Current Liabilities        $XXX,XXX       $XXX,XXX

Non-Current Liabilities
  Long-term debt                 $XXX,XXX       $XXX,XXX
  Other long-term liabilities     $XX,XXX        $XX,XXX
Total Non-Current Liabilities    $XXX,XXX       $XXX,XXX

TOTAL LIABILITIES              $X,XXX,XXX     $X,XXX,XXX

EQUITY
  Common stock                    $XX,XXX        $XX,XXX
  Additional paid-in capital     $XXX,XXX       $XXX,XXX
  Retained earnings              $XXX,XXX       $XXX,XXX
  Treasury stock                 ($XX,XXX)      ($XX,XXX)
TOTAL EQUITY                     $XXX,XXX       $XXX,XXX

TOTAL LIABILITIES + EQUITY     $X,XXX,XXX     $X,XXX,XXX
\`\`\`

**Verification:** Total Assets MUST equal Total Liabilities + Equity. If they don't, there's an error.

### Cash Flow Statement

Three sections:
1. **Operating activities** — Cash from core business operations
2. **Investing activities** — Cash from buying/selling long-term assets
3. **Financing activities** — Cash from debt, equity, and dividends

Start from net income, adjust for non-cash items, changes in working capital.

## Variance Analysis

### Budget vs. Actual

| Line Item | Budget | Actual | Variance ($) | Variance (%) | Status |
|-----------|--------|--------|-------------|-------------|--------|
| Revenue | $1,000K | $1,050K | +$50K | +5.0% | Favorable |
| COGS | $400K | $420K | -$20K | -5.0% | Unfavorable |
| Gross Profit | $600K | $630K | +$30K | +5.0% | Favorable |
| OpEx | $350K | $340K | +$10K | +2.9% | Favorable |
| Net Income | $250K | $290K | +$40K | +16.0% | Favorable |

**Convention:**
- Revenue variance: Positive = favorable (more revenue than expected)
- Expense variance: Positive = favorable (less expense than expected)
- Use color coding: green for favorable, red for unfavorable

### Variance Commentary

For each material variance (>5% or >$XX threshold), provide:
1. **What happened** — Describe the variance in plain language
2. **Why it happened** — Root cause (volume change, price change, timing, one-time event)
3. **Is it recurring?** — Will this variance persist in future periods?
4. **Action needed?** — Does the forecast need updating? Any corrective action?

## Key Financial Ratios

### Profitability
- **Gross margin** = Gross Profit / Revenue
- **Operating margin** = Operating Income / Revenue
- **Net margin** = Net Income / Revenue
- **ROE** = Net Income / Average Equity
- **ROA** = Net Income / Average Total Assets

### Liquidity
- **Current ratio** = Current Assets / Current Liabilities (target: >1.5)
- **Quick ratio** = (Current Assets - Inventory) / Current Liabilities (target: >1.0)
- **Cash ratio** = Cash / Current Liabilities

### Efficiency
- **Days Sales Outstanding (DSO)** = (Accounts Receivable / Revenue) x Days
- **Days Payable Outstanding (DPO)** = (Accounts Payable / COGS) x Days
- **Inventory turnover** = COGS / Average Inventory

### Leverage
- **Debt-to-equity** = Total Debt / Total Equity
- **Interest coverage** = EBIT / Interest Expense (target: >3x)

## Spreadsheet Formatting Standards

### Number Formats
- Currency: Thousands with commas, parentheses for negatives: $1,234 / ($567)
- Percentages: One decimal place: 12.3%
- Ratios: Two decimal places: 1.52x

### Layout Rules
- Row 1: Report title (bold, larger font)
- Row 2: Date/period
- Row 3: Blank
- Row 4: Column headers (bold, bottom border)
- Data rows: Indent sub-items by 2 spaces
- Subtotal rows: Bold with top border
- Grand total rows: Bold with double top border
- Negative numbers: Parentheses, not minus signs

### Sheet Structure
For multi-statement workbooks:
- Sheet 1: Summary / Dashboard
- Sheet 2: Income Statement
- Sheet 3: Balance Sheet
- Sheet 4: Cash Flow
- Sheet 5: Ratios
- Sheet 6: Assumptions / Source Data

## Guidelines

- **Verify the math.** Every total should be the sum of its components. Every balance sheet must balance. Cross-check ratios.
- **Use consistent periods.** Don't mix monthly and quarterly data without clear labels.
- **State assumptions.** If you're projecting or estimating, make every assumption explicit and separately listed.
- **Explain variances.** Numbers without narrative are hard to act on. Always accompany variance tables with commentary.
- **Format for readability.** Financial statements follow strict formatting conventions. Use indentation, bold totals, and consistent number formats.
- **Separate data from presentation.** Raw data on one sheet, formatted statements on another. This makes updates easier.
- **Note the basis.** GAAP, IFRS, or cash basis? Accrual or cash? State it clearly.
- **Caveat limitations.** If working from incomplete data, partial year, or estimates, say so prominently.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["generate_xlsx", "read_xlsx", "edit_xlsx"],
  requiredToolProfiles: ["docs", "analytics"],
  requiredIntegrationIds: [],
};
