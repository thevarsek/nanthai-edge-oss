// convex/skills/catalog/mktg_performance_report.ts
// =============================================================================
// System skill: marketing-performance-report
// Marketing metrics analysis with charts and recommendations.
// MAX-only sandbox skill.
// Inspired by Anthropic knowledge-work-plugins/marketing (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const MARKETING_PERFORMANCE_REPORT_SKILL: SystemSkillSeedData = {
  slug: "marketing-performance-report",
  name: "Marketing Performance Report",
  summary:
    "Analyze marketing campaign data, compute ROI/ROAS/CAC/LTV metrics, generate " +
    "performance charts, and produce executive-ready reports. Use when reviewing campaign " +
    "performance, channel attribution, or marketing spend efficiency.",
  instructionsRaw: `# Marketing Performance Report

Analyze marketing campaign data to produce executive-ready performance reports. Compute key marketing metrics (ROI, ROAS, CAC, LTV, conversion rates), create visualizations, and deliver actionable recommendations.

## Available Tools

- **workspace_import_file** — Import marketing data from NanthAI storage.
- **data_python_exec** — Run Python with pandas and matplotlib for analysis and charts.
- **workspace_export_file** — Export reports, charts, and data summaries.

## When to Use

- Analyzing campaign performance data (ad spend, conversions, revenue)
- Computing marketing ROI, ROAS, CAC, LTV, or other marketing metrics
- Creating channel-by-channel performance comparisons
- Building weekly/monthly marketing performance reports
- Evaluating marketing spend efficiency and recommending reallocation
- Producing board-ready or leadership marketing summaries

## Key Marketing Metrics

### Acquisition Metrics

\`\`\`python
import pandas as pd
import numpy as np

# Cost Per Acquisition (CPA) / Customer Acquisition Cost (CAC)
# CAC = Total marketing spend / New customers acquired
cac = total_spend / new_customers

# Cost Per Lead (CPL)
cpl = total_spend / leads_generated

# Cost Per Click (CPC)
cpc = total_spend / total_clicks

# Cost Per Mille (CPM) — cost per 1,000 impressions
cpm = (total_spend / impressions) * 1000
\`\`\`

### Revenue Metrics

\`\`\`python
# Return on Ad Spend (ROAS)
# ROAS = Revenue from ads / Ad spend
roas = attributed_revenue / ad_spend

# Marketing ROI
# ROI = (Revenue - Marketing Cost) / Marketing Cost
roi = (revenue - marketing_cost) / marketing_cost

# Lifetime Value (LTV)
# LTV = Average revenue per customer * Average customer lifespan
ltv = avg_revenue_per_customer * avg_lifespan_months

# LTV:CAC Ratio (target: >3:1)
ltv_cac_ratio = ltv / cac
\`\`\`

### Funnel Metrics

\`\`\`python
# Conversion rates at each funnel stage
impression_to_click = clicks / impressions  # CTR
click_to_lead = leads / clicks
lead_to_mql = mqls / leads
mql_to_sql = sqls / mqls
sql_to_opportunity = opportunities / sqls
opportunity_to_customer = customers / opportunities

# Overall conversion rate
overall_conversion = customers / impressions
\`\`\`

### Engagement Metrics
- **Click-Through Rate (CTR)** = Clicks / Impressions
- **Bounce Rate** = Single-page sessions / Total sessions
- **Avg. Session Duration** = Total session time / Sessions
- **Pages Per Session** = Total pageviews / Sessions
- **Email Open Rate** = Unique opens / Emails delivered
- **Email CTR** = Unique clicks / Emails delivered

## Report Structure

### Executive Summary Dashboard

Build a multi-chart dashboard with:

\`\`\`python
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

fig = plt.figure(figsize=(16, 10))
fig.suptitle("Marketing Performance — [Period]", fontsize=16, fontweight="bold")
gs = gridspec.GridSpec(3, 3, figure=fig, hspace=0.4, wspace=0.3)

# Row 1: KPI cards (4 across using colspan)
# Total Spend | Revenue Attributed | ROAS | CAC
kpis = [
    ("Total Spend", "\$XXK", "vs budget"),
    ("Revenue", "\$XXXK", "+XX% MoM"),
    ("ROAS", "X.Xx", "target: 3x"),
    # etc.
]

# Row 2: Spend by channel (bar) | ROAS by channel (bar)
# Row 3: Funnel conversion (horizontal bar) | Trend over time (line)

plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.show()
\`\`\`

### Channel Performance Table

| Channel | Spend | Impressions | Clicks | CTR | Leads | CPL | Customers | CAC | Revenue | ROAS |
|---------|-------|-------------|--------|-----|-------|-----|-----------|-----|---------|------|
| Paid Search | $XX | XX | XX | X.X% | XX | $XX | XX | $XXX | $XX | X.Xx |
| Paid Social | $XX | XX | XX | X.X% | XX | $XX | XX | $XXX | $XX | X.Xx |
| Email | $XX | — | XX | X.X% | XX | $XX | XX | $XXX | $XX | X.Xx |
| Organic | $XX | XX | XX | X.X% | XX | $XX | XX | $XXX | $XX | X.Xx |
| **Total** | **$XX** | **XX** | **XX** | **X.X%** | **XX** | **$XX** | **XX** | **$XXX** | **$XX** | **X.Xx** |

### Trend Analysis

\`\`\`python
# Month-over-month trends for key metrics
metrics_over_time = df.groupby("month").agg({
    "spend": "sum",
    "revenue": "sum",
    "customers": "sum",
}).reset_index()

metrics_over_time["roas"] = metrics_over_time["revenue"] / metrics_over_time["spend"]
metrics_over_time["cac"] = metrics_over_time["spend"] / metrics_over_time["customers"]

fig, axes = plt.subplots(2, 2, figsize=(14, 8))

# Top-left: Spend vs Revenue over time
# Top-right: ROAS trend with target line
# Bottom-left: CAC trend
# Bottom-right: Customer acquisition volume

plt.tight_layout()
plt.show()
\`\`\`

### Campaign-Level Breakdown

For each campaign or ad group:
- Spend and % of total budget
- Key performance metrics (impressions, clicks, conversions)
- ROAS and efficiency metrics
- Status: Scaling / Maintaining / Needs optimization / Pause recommended

### Recommendations

Based on the data, provide:

1. **Budget reallocation:** Which channels deserve more/less spend?
   - "Shift $X from [underperforming channel] to [outperforming channel]"
   - "Current ROAS on [channel] is X.Xx — below 2x threshold, recommend pausing"

2. **Optimization opportunities:**
   - "Campaign [X] has high CTR but low conversion — landing page may need work"
   - "[Channel] CPL decreased 15% MoM — consider scaling"

3. **Testing recommendations:**
   - "A/B test [specific element] — potential to improve [metric] by [estimate]"

4. **Risks and watch items:**
   - "CAC trending up 8% MoM — monitor closely"
   - "Channel [X] concentration risk — 60% of revenue from one channel"

## Output Format

Deliver:

1. **Executive summary** — 3-5 bullet points of the most important findings
2. **Dashboard figure** — Multi-chart performance dashboard via matplotlib
3. **Channel performance table** — Detailed metrics by channel
4. **Trend charts** — Key metrics over time
5. **Recommendations** — Prioritized, specific, data-backed actions
6. **Exported files** — Dashboard PNG, detailed metrics CSV, recommendation summary

## Guidelines

- **Start with the "so what."** Lead with insights and recommendations, not raw data.
- **Compare to benchmarks.** ROAS of 3x means nothing without context — is the target 2x or 5x? How does it compare to last period?
- **Attribution is messy.** Note the attribution model used and its limitations. Multi-touch is more accurate but harder to implement.
- **Separate vanity metrics from actionable metrics.** Impressions are vanity. ROAS is actionable. Report both but emphasize the latter.
- **Show trends, not just snapshots.** A single month's data is noisy. Show the direction over 3-6 months.
- **Segment before averaging.** Overall CAC might look fine while one channel's CAC is unsustainable. Always break down by channel/campaign.
- **Recommend specific actions.** "Improve performance" is useless. "Pause Campaign X (ROAS 0.8x), reallocate $5K to Campaign Y (ROAS 4.2x)" is actionable.
- **Acknowledge uncertainty.** If sample sizes are small or data is incomplete, say so.`,
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
