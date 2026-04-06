// convex/skills/catalog/pptx.ts
// =============================================================================
// System skill: pptx
// Adapted from .agents/skills/pptx/SKILL.md for NanthAI runtime.
// NanthAI has generate_pptx, read_pptx, edit_pptx tools.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const PPTX_SKILL: SystemSkillSeedData = {
  slug: "pptx",
  name: "Presentations",
  summary:
    "Create, read, edit, and manipulate PowerPoint presentations (.pptx). Covers slide design, " +
    "layouts, color palettes, typography, speaker notes, and professional deck structure. " +
    "Use when working with .pptx files, decks, slides, or presentations.",
  instructionsRaw: `# Presentation (PPTX) Skill

Create, read, and edit PowerPoint presentations using NanthAI's document tools. If Max analytics runtime tools are available, chart PNGs exported from data_python_exec can be embedded into slides the same way as any other stored image.

## Tools

- **generate_pptx** — Create a new .pptx presentation
- **read_pptx** — Extract text, structure, and notes from an existing .pptx
- **edit_pptx** — Replace content in an existing .pptx (read → regenerate)
- **fetch_image** — Fetch an image from a URL and store it. Returns an imageStorageId to embed in slides.
- **data_python_exec** — When available, use it to create chart PNGs or cleaned datasets before building the deck.

## Quick-Start Recipe

For most decks, just provide \`title\` and \`slides\`. A navy-blue themed title slide is auto-generated, then each slide in your array becomes a content slide:

\`\`\`
generate_pptx({
  title: "Q1 Business Review",
  subtitle: "March 2025",
  slides: [
    { title: "Revenue Overview", body: "Total revenue: $12.4M\\n+23% YoY growth\\nNorth America led at $6.2M" },
    { title: "Key Wins", body: "Closed 3 enterprise deals\\nLaunched v2.0 platform\\nReduced churn by 15%" }
  ]
})
\`\`\`

Defaults: Navy blue theme (#003B6F), Calibri font, 24pt titles, 16pt body, white slide background. Override only when asked.

## Slide Layouts

Each slide has an optional \`layout\` field. Default is \`"text"\`.

| Layout | When to use | Required fields |
|---|---|---|
| \`text\` (default) | Standard bullet slide, optionally with side images | title, body |
| \`split\` | Text on left, one large image on right | title, body, images (1) |
| \`image\` | Image grid / mood board (up to 9 images) | title, images |
| \`section\` | Section divider — large centered text on colored bg | title (+ optional body) |
| \`table\` | Title + data table | title, table |
| \`chart\` | Title + chart (bar, line, pie, doughnut, area) | title, chart |

**Default to \`text\` layout.** Only use specialized layouts when the content calls for it.

## Images: The fetch_image Workflow

To embed images in slides, **always use fetch_image first** to get an imageStorageId:

1. Call \`fetch_image({ url: "https://..." })\` → returns \`{ imageStorageId: "kg2..." }\`
2. Pass the storageId in the slide: \`images: [{ imageStorageId: "kg2...", altText: "Chart" }]\`

**Never pass raw base64 data.** Always use imageStorageId from fetch_image.

Image placement per layout:
- **text**: Up to 3 images stacked on the right side
- **split**: 1 image fills the right half
- **image**: Up to 9 in an auto-sized grid

If the user already has a generated chart image in NanthAI storage, reuse that storage-backed image directly in the slide instead of re-fetching it from the web.

### Background Images

Any slide can have a full-bleed background image:
\`\`\`
{ title: "Our Vision", body: "...", backgroundImage: { imageStorageId: "kg2...", altText: "Background" } }
\`\`\`

## Tables

Use \`layout: "table"\` with a \`table\` object:
\`\`\`
{
  title: "Regional Performance",
  layout: "table",
  table: {
    headers: ["Region", "Revenue", "Growth"],
    rows: [
      ["North America", "$6.2M", "+18%"],
      ["Europe", "$3.8M", "+12%"],
      ["Asia Pacific", "$2.4M", "+31%"]
    ]
  }
}
\`\`\`

Tables get themed headers (primary color bg, white text) and light borders automatically.

## Charts

Use \`layout: "chart"\` with a \`chart\` object:
\`\`\`
{
  title: "Revenue Trend",
  layout: "chart",
  chart: {
    type: "bar",
    labels: ["Q1", "Q2", "Q3", "Q4"],
    datasets: [
      { name: "2024", values: [8.2, 9.1, 10.5, 12.4] },
      { name: "2023", values: [6.5, 7.2, 8.0, 9.8] }
    ]
  }
}
\`\`\`

Supported chart types: \`bar\`, \`line\`, \`pie\`, \`doughnut\`, \`area\`. Default is \`bar\`.

- **bar/line/area**: Multiple datasets ok. Labels on x-axis.
- **pie/doughnut**: Usually 1 dataset. Labels are segments. Shows values and percentages automatically.
- Optional per-dataset \`color\` (hex, e.g. "#3498DB"). Defaults to theme colors.

## Theme Customization

Only customize when the user asks for specific branding:

\`\`\`
generate_pptx({
  title: "...",
  theme: {
    primaryColor: "1A5276",
    accentColor: "E74C3C",
    titleFont: "Georgia",
    bodyFont: "Arial"
  },
  slides: [...]
})
\`\`\`

| Theme field | Default | Used for |
|---|---|---|
| primaryColor | "003B6F" (navy) | Title slide bg, slide title text, table headers, chart primary |
| secondaryColor | "0066B2" | Chart secondary color |
| accentColor | "E74C3C" (red) | Highlights |
| titleFont | "Calibri" | Slide titles |
| bodyFont | same as titleFont | Body text, bullets |
| titleFontSize | 24 | Slide title size (pt) |
| bodyFontSize | 16 | Body/bullet size (pt) |
| backgroundColor | "FFFFFF" (white) | Default slide background |

**Pre-built palettes** (use when user says "make it look professional" without specific colors):
- **Corporate Blue** (default): primary "003B6F", accent "E74C3C"
- **Modern Dark**: primary "1A1A2E", secondary "0F3460", accent "E94560", backgroundColor "16213E"
- **Clean Minimal**: primary "2D3436", accent "0984E3"
- **Warm Professional**: primary "E67E22", secondary "F39C12", accent "2C3E50"

## Slide Numbers

Add \`showSlideNumbers: true\` to display numbers in the bottom-right corner of all slides.

## Speaker Notes

Always include speaker notes for presentation slides. Notes should expand on bullets, not repeat them:
\`\`\`
{ title: "Revenue", body: "...", notes: "Key talking point: North America drove 50% of growth due to the enterprise push in Q3..." }
\`\`\`

## Editing Presentations

edit_pptx uses a read → regenerate approach:

1. Use **read_pptx** to understand the existing deck (slides, text, structure, notes)
2. Call **edit_pptx** with storageId + the full updated title/slides
3. All layout and theme options from generate_pptx are available

The model must provide the complete slide list — this is a full replacement.

## Deck Structure Recipes

### Business Presentation (8–12 slides)
1. Title slide (auto-generated)
2. Agenda (text)
3. Context / Problem (text)
4. Key Insight (section divider)
5–7. Supporting Evidence (text/chart/table mix)
8. Recommendation (text)
9. Timeline (table)
10. Next Steps (text)

### Pitch Deck (10–12 slides)
1. Title + tagline
2. Problem (text)
3. Solution (text + image)
4. Market (chart)
5. Product (split — text + screenshot)
6. Business Model (table)
7. Traction (chart)
8. Team (text)
9. Competition (table)
10. Financials (chart)
11. The Ask (section divider)

### Status Update (5–7 slides)
1. Title + date
2. Executive Summary (text)
3. Key Metrics (table or chart)
4. Accomplishments (text)
5. Risks (text)
6. Next Period (text)

## Design Principles

- **One message per slide.** If you need two, use two slides.
- **6×6 rule:** Max 6 bullets, max 6 words per bullet.
- **Title = takeaway.** "Revenue grew 23%" not just "Revenue."
- **Use section dividers** between major topics to signal shifts.
- **Charts for trends, tables for comparisons.** Don't put 20 data points in bullets.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "anthropicCurated",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["generate_pptx", "read_pptx", "edit_pptx"],
  requiredToolProfiles: ["docs"],
  requiredIntegrationIds: [],
};
