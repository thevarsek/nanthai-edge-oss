// convex/skills/catalog/data_statistical_analysis.ts
// =============================================================================
// System skill: statistical-analysis
// Formal statistical testing, regression diagnostics, and power analysis.
// MAX-only sandbox skill.
// Inspired by Anthropic knowledge-work-plugins/data (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const STATISTICAL_ANALYSIS_SKILL: SystemSkillSeedData = {
  slug: "statistical-analysis",
  name: "Statistical Analysis",
  summary:
    "Run formal statistical tests (t-tests, chi-square, ANOVA, regression), power analysis, " +
    "and confidence intervals on uploaded data. Use when the user needs rigorous hypothesis " +
    "testing rather than exploratory charts.",
  instructionsRaw: `# Statistical Analysis

Run formal statistical analyses on user data: hypothesis testing, regression, ANOVA, correlation testing, confidence intervals, effect size estimation, and power analysis. Translate results into plain-language findings with appropriate caveats.

## Available Tools

- **workspace_import_file** — Import a user-owned file from NanthAI storage into the chat workspace.
- **data_python_exec** — Run Python with scipy, numpy, pandas, and matplotlib for statistical computation and visualization.
- **workspace_export_file** — Export results, tables, and charts back to NanthAI storage.

## When to Use

- User asks for hypothesis testing ("is this difference significant?")
- User wants regression analysis (linear, logistic, multiple)
- User needs ANOVA, chi-square, or other formal tests
- User asks about confidence intervals or effect sizes
- User needs power analysis or sample size calculations
- User wants to validate assumptions (normality, homoscedasticity)

## Standard Libraries

\`\`\`python
import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

# statsmodels available for advanced regression and time series:
# import statsmodels.api as sm
# import statsmodels.formula.api as smf
# from statsmodels.stats.power import TTestPower, TTestIndPower
# from statsmodels.stats.multicomp import pairwise_tukeyhsd
\`\`\`

## Workflow

### 1. Understand the Question

Before running any test, clarify:
- **What is the hypothesis?** What does the user believe or want to test?
- **What are the variables?** Independent (grouping/predictor) vs. dependent (outcome)
- **What type of data?** Continuous, categorical, ordinal, counts
- **What is the comparison?** Two groups, multiple groups, association, prediction

### 2. Check Assumptions

Every statistical test has assumptions. Check them before running the test:

**Normality (for parametric tests):**
\`\`\`python
# Shapiro-Wilk test (n < 5000)
stat, p = stats.shapiro(data)
print(f"Shapiro-Wilk: W={stat:.4f}, p={p:.4f}")
# p > 0.05 → fail to reject normality

# Q-Q plot for visual check
stats.probplot(data, dist="norm", plot=plt)
plt.title("Q-Q Plot")
plt.tight_layout()
plt.show()
\`\`\`

**Homogeneity of variance (for t-tests, ANOVA):**
\`\`\`python
stat, p = stats.levene(group1, group2)
print(f"Levene's test: F={stat:.4f}, p={p:.4f}")
# p > 0.05 → variances are roughly equal
\`\`\`

**Independence:** Confirm data points are independent (not repeated measures unless using paired tests).

### 3. Select and Run the Appropriate Test

#### Comparing Two Groups

| Scenario | Test |
|----------|------|
| Two independent groups, normal data | Independent t-test |
| Two independent groups, non-normal | Mann-Whitney U |
| Two paired/matched samples, normal | Paired t-test |
| Two paired/matched samples, non-normal | Wilcoxon signed-rank |

\`\`\`python
# Independent t-test
t_stat, p_val = stats.ttest_ind(group1, group2, equal_var=True)
# Use equal_var=False for Welch's t-test (unequal variances)

# Effect size (Cohen's d)
d = (np.mean(group1) - np.mean(group2)) / np.sqrt(
    ((len(group1)-1)*np.var(group1, ddof=1) + (len(group2)-1)*np.var(group2, ddof=1))
    / (len(group1) + len(group2) - 2)
)
print(f"t={t_stat:.4f}, p={p_val:.4f}, Cohen's d={d:.3f}")
\`\`\`

#### Comparing Multiple Groups

| Scenario | Test |
|----------|------|
| 3+ independent groups, normal data | One-way ANOVA |
| 3+ independent groups, non-normal | Kruskal-Wallis |
| Post-hoc pairwise comparisons | Tukey's HSD |

\`\`\`python
# One-way ANOVA
f_stat, p_val = stats.f_oneway(group1, group2, group3)
print(f"F={f_stat:.4f}, p={p_val:.4f}")

# Eta-squared effect size
ss_between = sum(len(g) * (np.mean(g) - np.mean(np.concatenate([group1, group2, group3])))**2
                 for g in [group1, group2, group3])
ss_total = np.var(np.concatenate([group1, group2, group3]), ddof=0) * (len(group1)+len(group2)+len(group3))
eta_sq = ss_between / ss_total
print(f"Eta-squared: {eta_sq:.4f}")

# Post-hoc: Tukey's HSD (if ANOVA is significant)
# from statsmodels.stats.multicomp import pairwise_tukeyhsd
# tukey = pairwise_tukeyhsd(values, groups, alpha=0.05)
# print(tukey)
\`\`\`

#### Categorical Data

| Scenario | Test |
|----------|------|
| Two categorical variables (independence) | Chi-square test |
| Small expected counts (<5) | Fisher's exact test |
| Proportions comparison | z-test for proportions |

\`\`\`python
# Chi-square test of independence
contingency = pd.crosstab(df["category"], df["outcome"])
chi2, p, dof, expected = stats.chi2_contingency(contingency)
print(f"Chi-square={chi2:.4f}, p={p:.4f}, df={dof}")

# Cramér's V (effect size for chi-square)
n = contingency.sum().sum()
v = np.sqrt(chi2 / (n * (min(contingency.shape) - 1)))
print(f"Cramér's V: {v:.4f}")
\`\`\`

#### Correlation

| Scenario | Test |
|----------|------|
| Two continuous, linear relationship | Pearson r |
| Ordinal data or non-linear | Spearman rho |
| Ordinal, small sample | Kendall tau |

\`\`\`python
r, p = stats.pearsonr(x, y)
print(f"Pearson r={r:.4f}, p={p:.4f}")

rho, p = stats.spearmanr(x, y)
print(f"Spearman rho={rho:.4f}, p={p:.4f}")
\`\`\`

#### Regression

\`\`\`python
from scipy import stats

# Simple linear regression
slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
print(f"y = {slope:.4f}x + {intercept:.4f}")
print(f"R² = {r_value**2:.4f}, p = {p_value:.4f}")

# Multiple regression (with statsmodels)
# import statsmodels.api as sm
# X = sm.add_constant(df[["predictor1", "predictor2"]])
# model = sm.OLS(df["outcome"], X).fit()
# print(model.summary())
\`\`\`

### 4. Confidence Intervals

Always provide confidence intervals alongside point estimates:

\`\`\`python
# CI for a mean
mean = np.mean(data)
se = stats.sem(data)
ci = stats.t.interval(0.95, df=len(data)-1, loc=mean, scale=se)
print(f"Mean: {mean:.4f}, 95% CI: [{ci[0]:.4f}, {ci[1]:.4f}]")

# CI for difference between means (independent groups)
diff = np.mean(group1) - np.mean(group2)
se_diff = np.sqrt(stats.sem(group1)**2 + stats.sem(group2)**2)
ci_diff = stats.t.interval(0.95, df=min(len(group1), len(group2))-1, loc=diff, scale=se_diff)
print(f"Difference: {diff:.4f}, 95% CI: [{ci_diff[0]:.4f}, {ci_diff[1]:.4f}]")
\`\`\`

### 5. Power Analysis

\`\`\`python
# Using scipy for basic power estimation
# For more advanced: from statsmodels.stats.power import TTestIndPower

# Required sample size for independent t-test
# power_analysis = TTestIndPower()
# n = power_analysis.solve_power(effect_size=0.5, alpha=0.05, power=0.8)
# print(f"Required sample size per group: {int(np.ceil(n))}")

# Post-hoc power (given observed effect and sample size)
# power = power_analysis.solve_power(effect_size=d, nobs1=len(group1), alpha=0.05)
# print(f"Observed power: {power:.4f}")
\`\`\`

## Output Format

### Statistical Report

**Research Question:** [What the user wanted to test]

**Data Summary:**
- N = [total observations]
- Groups: [group names and sizes]
- Variables: [predictor(s) and outcome(s)]

**Assumption Checks:**
| Assumption | Test | Result | Implication |
|-----------|------|--------|-------------|
| Normality | Shapiro-Wilk | W=0.98, p=0.15 | Met |
| Equal variance | Levene's | F=1.2, p=0.28 | Met |

**Test Results:**
- **Test used:** [name and why chosen]
- **Test statistic:** [value]
- **p-value:** [value]
- **Effect size:** [value and interpretation]
- **95% Confidence Interval:** [lower, upper]

**Interpretation:**
[Plain-language explanation of what the results mean in the context of the user's question. Avoid jargon. State whether the result is statistically significant and practically meaningful.]

**Caveats:**
- [Sample size limitations]
- [Assumption violations]
- [Correlation vs. causation]
- [Multiple comparisons issues]

## Effect Size Interpretation Guide

| Metric | Small | Medium | Large |
|--------|-------|--------|-------|
| Cohen's d | 0.2 | 0.5 | 0.8 |
| Pearson r | 0.1 | 0.3 | 0.5 |
| Eta-squared | 0.01 | 0.06 | 0.14 |
| Cramér's V (df=1) | 0.1 | 0.3 | 0.5 |

## Guidelines

- **Always check assumptions first.** Running a t-test on non-normal data gives misleading results. Use non-parametric alternatives when assumptions are violated.
- **Report effect sizes, not just p-values.** A tiny effect can be "significant" with a large enough sample. Effect size tells you if it matters.
- **Provide confidence intervals.** They convey more information than a single point estimate.
- **Correct for multiple comparisons.** If running many tests, use Bonferroni correction or control FDR. State the correction used.
- **Use plain language.** "The treatment group scored 12 points higher on average (95% CI: 8-16, p < 0.001)" is better than "the null hypothesis was rejected."
- **Don't say "proved."** Statistics don't prove — they provide evidence for or against. Use "suggests," "supports," "is consistent with."
- **Disclose limitations.** Small samples, non-random sampling, and observational (non-experimental) designs all limit what conclusions can be drawn.
- **Visualize distributions.** A histogram or box plot often reveals more than a test statistic.`,
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
