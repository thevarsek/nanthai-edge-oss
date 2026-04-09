// convex/skills/catalog/data_sql_query.ts
// =============================================================================
// System skill: sql-data-query
// SQL query writing, execution against uploaded datasets (sqlite3 + pandas).
// MAX-only sandbox skill.
// Inspired by Anthropic knowledge-work-plugins/data (Apache 2.0).
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const SQL_DATA_QUERY_SKILL: SystemSkillSeedData = {
  slug: "sql-data-query",
  name: "SQL Data Query",
  summary:
    "Write and run SQL queries against uploaded CSV/XLSX data using an in-sandbox SQLite database. " +
    "Use when the user wants to filter, join, aggregate, or transform tabular data with SQL " +
    "rather than pandas code.",
  instructionsRaw: `# SQL Data Query

Write and execute SQL queries against user-uploaded datasets. Load CSV/XLSX files into an in-memory SQLite database, then run SQL for filtering, joins, aggregations, window functions, and ad-hoc exploration.

## Available Tools

- **workspace_import_file** — Import a user-owned file from NanthAI storage into the chat workspace.
- **data_python_exec** — Run Python that uses sqlite3 + pandas to load data and execute SQL.
- **workspace_export_file** — Export query results or derived tables back to NanthAI storage.

## When to Use

- User asks to "query", "filter", "join", or "aggregate" tabular data
- User provides SQL or asks for SQL to be written
- User wants to combine multiple tables/files with JOINs
- User wants window functions, CTEs, or other SQL-specific constructs
- User prefers SQL syntax over pandas for data manipulation

## Workflow

### 1. Load Data into SQLite

\`\`\`python
import sqlite3
import pandas as pd

# Load CSV/XLSX into pandas, then into SQLite
df = pd.read_csv("inputs/sales.csv")
conn = sqlite3.connect(":memory:")
df.to_sql("sales", conn, index=False, if_exists="replace")

# For multiple files, repeat:
df2 = pd.read_excel("inputs/customers.xlsx")
df2.to_sql("customers", conn, index=False, if_exists="replace")
\`\`\`

### 2. Explore the Schema

Before writing queries, inspect what's available:

\`\`\`python
# List tables
tables = pd.read_sql("SELECT name FROM sqlite_master WHERE type='table'", conn)
print(tables)

# Show columns for each table
for t in tables["name"]:
    info = pd.read_sql(f"PRAGMA table_info({t})", conn)
    print(f"\\n--- {t} ---")
    print(info[["name", "type"]].to_string(index=False))
\`\`\`

### 3. Write and Execute Queries

\`\`\`python
query = """
SELECT
    region,
    COUNT(*) AS order_count,
    SUM(revenue) AS total_revenue,
    AVG(revenue) AS avg_revenue
FROM sales
GROUP BY region
ORDER BY total_revenue DESC
"""
result = pd.read_sql(query, conn)
print(result.to_string(index=False))
\`\`\`

### 4. Export Results

\`\`\`python
# Save query results to CSV (auto-captured as download card)
result.to_csv("/tmp/outputs/regional_summary.csv", index=False)
\`\`\`

## SQL Best Practices

### Query Structure
- Always use explicit column names — avoid \`SELECT *\` in final outputs
- Use CTEs (\`WITH\` clauses) for readability in complex queries
- Add \`ORDER BY\` to make results deterministic
- Use aliases for clarity: \`SUM(revenue) AS total_revenue\`

### Common Patterns

**Aggregation with filtering:**
\`\`\`sql
SELECT category, SUM(amount) AS total
FROM transactions
WHERE date >= '2024-01-01'
GROUP BY category
HAVING SUM(amount) > 1000
ORDER BY total DESC
\`\`\`

**Window functions (running totals, ranks):**
\`\`\`sql
SELECT
    date,
    revenue,
    SUM(revenue) OVER (ORDER BY date) AS cumulative_revenue,
    RANK() OVER (ORDER BY revenue DESC) AS revenue_rank
FROM daily_sales
\`\`\`

**CTEs for multi-step logic:**
\`\`\`sql
WITH monthly AS (
    SELECT
        strftime('%Y-%m', date) AS month,
        SUM(revenue) AS revenue
    FROM sales
    GROUP BY 1
),
growth AS (
    SELECT
        month,
        revenue,
        LAG(revenue) OVER (ORDER BY month) AS prev_revenue
    FROM monthly
)
SELECT
    month,
    revenue,
    ROUND((revenue - prev_revenue) * 100.0 / prev_revenue, 1) AS growth_pct
FROM growth
WHERE prev_revenue IS NOT NULL
\`\`\`

**JOINs across tables:**
\`\`\`sql
SELECT
    c.name,
    c.region,
    COUNT(o.id) AS order_count,
    SUM(o.total) AS lifetime_value
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id
GROUP BY c.name, c.region
ORDER BY lifetime_value DESC
\`\`\`

### SQLite-Specific Notes
- Use \`strftime()\` for date functions (not \`DATE_TRUNC\` or \`EXTRACT\`)
- \`IFNULL()\` instead of \`COALESCE()\` is also available but \`COALESCE\` works too
- \`||\` for string concatenation
- SQLite is case-insensitive for keywords but case-sensitive for identifiers by default
- No native \`MEDIAN\` — use a subquery or pandas for percentile calculations

## Output Format

### Query Results
- Print results as formatted tables using \`df.to_string(index=False)\`
- For large results (>50 rows), show the first 20 rows and summarize the rest
- Always state the row count: "Query returned 1,234 rows"

### Query Explanation
When writing SQL for the user:
1. Show the complete query with comments
2. Explain the logic in plain language
3. Note any assumptions made about the data
4. Suggest variations or follow-up queries

## Guidelines

- **Inspect before querying.** Always check table schemas and sample rows before writing complex queries.
- **Validate results.** Spot-check aggregations against raw data (e.g., manually verify a SUM for one group).
- **Handle NULLs explicitly.** Use COALESCE or IFNULL to handle missing values rather than letting them silently propagate.
- **Explain the SQL.** Users may want to learn — walk through the query logic.
- **Export useful outputs.** Save query results to CSV files in \`/tmp/outputs/\` so they appear as download cards (e.g., \`df.to_csv('/tmp/outputs/results.csv', index=False)\`).
- **One query at a time.** Run and validate each query before building on it.`,
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
