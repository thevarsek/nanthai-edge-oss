// convex/skills/catalog/data_dashboard_builder.ts
// =============================================================================
// System skill: dashboard-builder
// Multi-chart dashboard construction with matplotlib/plotly.
// MAX-only sandbox skill.
// Inspired by Anthropic knowledge-work-plugins/data (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const DASHBOARD_BUILDER_SKILL: SystemSkillSeedData = {
  slug: "dashboard-builder",
  name: "Dashboard Builder",
  summary:
    "Create multi-chart dashboards and executive summary visualizations from uploaded data. " +
    "Use when the user wants a set of coordinated charts, a KPI dashboard, or a visual " +
    "report rather than a single chart.",
  instructionsRaw: `# Dashboard Builder

Create coordinated multi-chart dashboards and visual reports from user data. Combine KPI cards, trend lines, bar charts, and tables into cohesive visual summaries suitable for executive review or team sharing.

## Available Tools

- **workspace_import_file** — Import a user-owned file from NanthAI storage into the chat workspace.
- **data_python_exec** — Run Python with pandas, matplotlib, and seaborn for dashboard construction.
- **workspace_export_file** — Export dashboard images and data files back to NanthAI storage.

## When to Use

- User asks for a "dashboard," "visual report," or "executive summary"
- User wants multiple related charts from a single dataset
- User needs KPI cards with metrics + sparklines
- User wants a "one-pager" or "snapshot" of their data
- User asks to visualize multiple dimensions of the same dataset

## Dashboard Design Principles

### Layout
- **One figure per dashboard** — use matplotlib subplots to arrange charts in a grid
- **Standard sizes:** 16x10 or 16x12 for landscape dashboards, 12x16 for portrait
- **Grid alignment:** Use \`fig.add_gridspec()\` for precise control over panel sizes
- **White space:** \`fig.tight_layout(pad=2.0)\` or manual \`subplots_adjust\`
- **Title:** Large, clear dashboard title at top using \`fig.suptitle()\`

### Visual Hierarchy
- **KPI cards first** — top row should show headline numbers
- **Trends second** — time-series charts in the middle
- **Details third** — breakdowns, comparisons, and tables at the bottom
- **Consistent colors** — use a single color palette across all charts

### Typography
- Dashboard title: 16-18pt, bold
- Chart titles: 12-14pt, bold
- Axis labels: 10-11pt
- Annotations: 9-10pt
- KPI numbers: 24-32pt, bold

## Dashboard Templates

### Template 1: Executive KPI Dashboard

\`\`\`python
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np

fig = plt.figure(figsize=(16, 10))
fig.suptitle("Monthly Business Dashboard — January 2025", fontsize=18, fontweight="bold", y=0.98)

gs = gridspec.GridSpec(3, 4, figure=fig, hspace=0.4, wspace=0.3)

# Row 1: KPI cards (4 across)
kpis = [
    ("Revenue", "$2.4M", "+12%", "green"),
    ("Customers", "1,847", "+8%", "green"),
    ("Churn Rate", "3.2%", "-0.5%", "green"),
    ("NPS Score", "72", "-3", "red"),
]
for i, (label, value, change, color) in enumerate(kpis):
    ax = fig.add_subplot(gs[0, i])
    ax.text(0.5, 0.65, value, ha="center", va="center", fontsize=28, fontweight="bold")
    ax.text(0.5, 0.30, label, ha="center", va="center", fontsize=12, color="gray")
    ax.text(0.5, 0.10, change, ha="center", va="center", fontsize=11, color=color, fontweight="bold")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.patch.set_facecolor("#f8f9fa")
    ax.patch.set_alpha(1)

# Row 2: Trend line (full width left) + pie chart (right)
ax_trend = fig.add_subplot(gs[1, :3])
# ... populate with actual time series data
ax_trend.set_title("Revenue Trend (12 months)", fontsize=12, fontweight="bold")

ax_pie = fig.add_subplot(gs[1, 3])
ax_pie.set_title("Revenue by Segment", fontsize=12, fontweight="bold")

# Row 3: Bar chart (left half) + table or second bar (right half)
ax_bar = fig.add_subplot(gs[2, :2])
ax_bar.set_title("Top Products by Revenue", fontsize=12, fontweight="bold")

ax_bar2 = fig.add_subplot(gs[2, 2:])
ax_bar2.set_title("Revenue by Region", fontsize=12, fontweight="bold")

plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.show()
fig.savefig("outputs/dashboard.png", dpi=150, bbox_inches="tight")
\`\`\`

### Template 2: Comparison Dashboard

\`\`\`python
fig, axes = plt.subplots(2, 2, figsize=(14, 10))
fig.suptitle("A/B Test Results Dashboard", fontsize=16, fontweight="bold")

# Top-left: Conversion rates
# Top-right: Revenue per user
# Bottom-left: Distribution comparison (box plot or histogram)
# Bottom-right: Statistical summary table

plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.show()
\`\`\`

### Template 3: Time Series Dashboard

\`\`\`python
fig = plt.figure(figsize=(16, 12))
gs = gridspec.GridSpec(4, 2, figure=fig, hspace=0.4, wspace=0.3)

# Row 1: Main metric over time (full width)
# Row 2: Two related metrics side by side
# Row 3: Year-over-year comparison (left) + seasonality (right)
# Row 4: Anomaly highlights or data table

fig.suptitle("Traffic & Engagement — Q4 2024", fontsize=16, fontweight="bold")
plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.show()
\`\`\`

## Styling Guide

### Color Palettes

Use consistent palettes. Pick one per dashboard:

\`\`\`python
# Professional blue
COLORS = ["#1a73e8", "#4285f4", "#8ab4f8", "#c6dafc", "#e8f0fe"]

# Warm earth tones
COLORS = ["#e8710a", "#f4a261", "#e76f51", "#2a9d8f", "#264653"]

# Neutral with accent
COLORS = ["#2d3436", "#636e72", "#b2bec3", "#dfe6e9", "#0984e3"]

# Positive/negative
COLOR_POS = "#34a853"
COLOR_NEG = "#ea4335"
COLOR_NEUTRAL = "#5f6368"
\`\`\`

### Formatting Numbers

\`\`\`python
def format_currency(val):
    if abs(val) >= 1_000_000:
        return f"\${val/1_000_000:.1f}M"
    elif abs(val) >= 1_000:
        return f"\${val/1_000:.0f}K"
    return f"\${val:.0f}"

def format_pct(val):
    sign = "+" if val > 0 else ""
    return f"{sign}{val:.1f}%"

def format_number(val):
    if abs(val) >= 1_000_000:
        return f"{val/1_000_000:.1f}M"
    elif abs(val) >= 1_000:
        return f"{val/1_000:.1f}K"
    return f"{val:,.0f}"
\`\`\`

### Chart Styling Defaults

\`\`\`python
# Apply at start of each dashboard
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "grid.linestyle": "--",
})
\`\`\`

## Workflow

### 1. Understand the Data and Audience
- Import the data file(s)
- Inspect dimensions, columns, date ranges
- Ask: who will see this dashboard? What decisions does it support?
- Identify the 3-5 most important metrics

### 2. Plan the Layout
- Decide which template fits (KPI, comparison, time series, or custom)
- Map metrics to chart types:
  - **Single number/KPI** → text card
  - **Trend over time** → line chart
  - **Category comparison** → bar chart (horizontal if many categories)
  - **Part of whole** → pie/donut (only if ≤6 categories)
  - **Distribution** → histogram or box plot
  - **Relationship** → scatter plot
  - **Ranking** → horizontal bar chart

### 3. Build Incrementally
- Start with KPI cards (top row)
- Add the primary trend chart
- Add supporting charts
- Add annotations, labels, and formatting last
- Show each figure with \`plt.show()\` so NanthAI renders it

### 4. Export
- Save the full dashboard as PNG at 150 DPI
- Optionally save underlying data tables as CSV
- Export via workspace_export_file

## Output Format

When delivering a dashboard:

1. **Dashboard description** — Brief text explaining what the dashboard shows and key takeaways
2. **Dashboard figure** — The matplotlib figure rendered via \`plt.show()\`
3. **Key insights** — 3-5 bullet points highlighting what the data reveals
4. **Exported files** — PNG dashboard image and any supporting data files

## Guidelines

- **Less is more.** 4-6 charts per dashboard is the sweet spot. Don't overcrowd.
- **One story per dashboard.** Each dashboard should answer a coherent set of related questions.
- **KPIs need context.** A number alone is meaningless — add period-over-period change, targets, or benchmarks.
- **Label everything.** Every chart needs a title. Every axis needs a label. Units should be explicit.
- **Consistent scales.** If comparing two charts, use the same y-axis range when possible.
- **Color with purpose.** Use color to highlight, not to decorate. Red = bad, green = good is a strong convention.
- **Build for the reader.** An executive wants headlines and trends. An analyst wants detail and breakdowns. Ask who the audience is.
- **Test readability.** After building, ask: can someone understand each chart in 5 seconds?`,
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
