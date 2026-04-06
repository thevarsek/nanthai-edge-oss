// convex/skills/catalog/gtm_seo.ts
// =============================================================================
// System skill: ai-seo
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const SEO_SKILL: SystemSkillSeedData = {
  slug: "ai-seo",
  name: "SEO Strategy",
  summary:
    "Build an SEO strategy with keyword research, content planning, technical optimization, " +
    "and competitor analysis. Covers programmatic SEO, comparison pages, and AI search optimization.",
  instructionsRaw: `# SEO Strategy

Build and execute organic search strategies that drive sustainable traffic through keyword research, content planning, technical optimization, and AI search readiness.

## When to Use

- Building an organic traffic engine from scratch
- Planning a content calendar with SEO goals
- Auditing an existing site's search performance
- Creating programmatic SEO pages at scale (comparisons, alternatives, use cases)
- Analyzing competitor SEO strategies
- Optimizing for AI Overviews and AI-powered search

## Instructions

When asked to create an SEO strategy, follow these steps:

1. **Keyword Research & Intent Mapping**
   Start with problems your audience searches for, not your product features.

   **Intent categories:**
   - **Informational:** "how to," "what is," "guide to" — top of funnel, build authority.
   - **Commercial investigation:** "best," "vs," "alternatives to," "review" — mid funnel, capture comparison shoppers.
   - **Transactional:** "pricing," "signup," "buy," "free trial" — bottom funnel, convert.

   **Keyword evaluation framework:**
   | Factor | Assessment |
   |--------|-----------|
   | Search volume | Monthly searches (high/medium/low) |
   | Difficulty | How competitive is page 1? (easy/medium/hard) |
   | Intent match | Does searcher intent align with what you offer? |
   | Business value | If you ranked #1, would it drive revenue? |

   Prioritize keywords where intent match and business value are high, even if volume is modest. A keyword with 200 monthly searches and strong purchase intent beats 10,000 searches with no commercial relevance.

2. **Content Strategy: Pillar + Cluster Model**
   Organize content into topic clusters, not isolated pages.

   - **Pillar page:** Comprehensive guide on a broad topic (2,000-4,000 words). Targets the head keyword.
   - **Cluster pages:** Focused articles on subtopics that link back to the pillar. Each targets a long-tail keyword.
   - **Internal linking:** Every cluster page links to its pillar. Pillar links to all clusters. This builds topical authority.

   Example cluster:
   - Pillar: "Complete Guide to [Your Category]"
   - Clusters: "How to [Specific Task]," "[Your Category] for [Use Case]," "[Tool A] vs [Tool B] for [Category]"

3. **Programmatic SEO at Scale**
   For products with structured data, create templatized pages that target long-tail keywords:

   - **Comparison pages:** "[Your Product] vs [Competitor]" — address objections, highlight differences honestly.
   - **Alternatives pages:** "[Competitor] alternatives" — capture users actively evaluating options.
   - **Use-case pages:** "[Your Category] for [Industry/Role]" — show relevance to specific audiences.
   - **Integration pages:** "[Your Product] + [Tool]" — capture searches from partner ecosystems.

   Each page needs unique, valuable content — not just swapped names. Include genuine analysis, feature comparisons, and user context.

4. **Technical SEO Fundamentals**
   Content quality won't matter if search engines can't crawl and index your pages properly.

   **Audit checklist:**
   - Page speed: Core Web Vitals passing (LCP < 2.5s, CLS < 0.1, INP < 200ms)
   - Mobile-friendly: responsive design, no horizontal scroll, tap targets sized correctly
   - Crawlability: clean sitemap.xml, robots.txt not blocking important pages, no orphan pages
   - Indexation: canonical tags set correctly, no duplicate content, proper hreflang for i18n
   - Structure: heading hierarchy (single H1, logical H2-H3 nesting), descriptive URLs
   - Schema markup: FAQ, HowTo, Product, Article structured data where applicable

5. **AI Search Optimization**
   AI Overviews and AI-powered search engines (Perplexity, ChatGPT search) are changing how users find information.

   **Optimize for AI extraction:**
   - Write clear, direct answers in the first paragraph — AI models pull from concise statements.
   - Use structured formats: tables, numbered lists, definition patterns ("X is...").
   - Include authoritative data: statistics, citations, original research.
   - Answer follow-up questions on the same page — AI models reward comprehensive coverage.
   - Build entity authority: be consistently referenced as an expert source across the web.

6. **Competitor SEO Analysis**
   Understand what's working for competitors to find gaps and opportunities:
   - Identify their top-performing pages by estimated traffic.
   - Analyze their content gaps — keywords they rank for that you don't.
   - Study their backlink sources for partnership and outreach opportunities.
   - Review their site structure and internal linking patterns.

## Output Format

### [Product/Site] SEO Strategy

**Goal:** [Traffic target, ranking targets, or revenue from organic]
**Timeline:** [3/6/12 month plan]
**Current state:** [Baseline metrics if available]

#### Keyword Matrix
| Keyword | Intent | Volume | Difficulty | Business Value | Priority |
|---------|--------|--------|-----------|---------------|----------|
| ... | Info/Commercial/Transactional | H/M/L | H/M/L | H/M/L | P1/P2/P3 |

#### Content Plan
| Content Piece | Target Keyword | Type | Funnel Stage | Priority |
|--------------|---------------|------|-------------|----------|
| ... | ... | Pillar/Cluster/Programmatic | Top/Mid/Bottom | P1/P2/P3 |

#### Programmatic SEO Opportunities
Templates identified, estimated page count, and target keyword patterns.

#### Technical Audit Checklist
Pass/fail assessment of each technical factor with remediation steps.

#### AI Search Readiness
Specific optimizations for AI Overview visibility.

#### Competitor Gaps
Keywords and content types competitors rank for that represent opportunities.

## SEO Audit Mode

When asked to "audit" a site or page, use this structured checklist format:

### On-Page SEO Audit: [URL or Page]

| Factor | Status | Finding | Action |
|--------|--------|---------|--------|
| **Title tag** | Pass/Fail | [Current title, length] | [Recommendation] |
| **Meta description** | Pass/Fail | [Current desc, length] | [Recommendation] |
| **H1 tag** | Pass/Fail | [Current H1, is there exactly one?] | [Recommendation] |
| **Heading hierarchy** | Pass/Fail | [H2/H3 structure logical?] | [Recommendation] |
| **URL structure** | Pass/Fail | [Is it clean, descriptive, short?] | [Recommendation] |
| **Internal links** | Pass/Fail | [Count, are they relevant?] | [Recommendation] |
| **Image alt text** | Pass/Fail | [Missing alts count] | [Recommendation] |
| **Schema markup** | Pass/Fail | [What types present?] | [Recommendation] |
| **Content depth** | Pass/Fail | [Word count, topic coverage] | [Recommendation] |
| **Keyword targeting** | Pass/Fail | [Primary keyword in title/H1/first para?] | [Recommendation] |

### Technical SEO Audit: [Site]

| Factor | Status | Finding | Action |
|--------|--------|---------|--------|
| **Core Web Vitals (LCP)** | Pass/Fail | [Value] | [Fix if > 2.5s] |
| **Core Web Vitals (CLS)** | Pass/Fail | [Value] | [Fix if > 0.1] |
| **Core Web Vitals (INP)** | Pass/Fail | [Value] | [Fix if > 200ms] |
| **Mobile-friendly** | Pass/Fail | [Issues found] | [Fixes] |
| **robots.txt** | Pass/Fail | [Blocking important pages?] | [Fixes] |
| **sitemap.xml** | Pass/Fail | [Present? Up to date?] | [Fixes] |
| **Canonical tags** | Pass/Fail | [Self-referencing? Consistent?] | [Fixes] |
| **HTTPS** | Pass/Fail | [Mixed content?] | [Fixes] |
| **Redirect chains** | Pass/Fail | [Any 301 chains > 2 hops?] | [Fixes] |
| **Orphan pages** | Pass/Fail | [Pages with no internal links?] | [Fixes] |

### Priority Actions
1. [Most impactful fix with estimated effort]
2. [Second priority]
3. [Third priority]

## Quality Checklist

- [ ] Keywords are prioritized by business value, not just volume
- [ ] Intent mapping is explicit for every target keyword
- [ ] Content plan uses pillar + cluster structure with internal linking
- [ ] Programmatic pages have genuinely unique content, not just template swaps
- [ ] Technical SEO fundamentals are audited and addressed
- [ ] AI search optimization is included alongside traditional SEO
- [ ] Competitor analysis identifies actionable gaps, not just observations
- [ ] Timeline and milestones are realistic and measurable`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "textOnly",
  requiredToolIds: [],
  requiredIntegrationIds: [],
};
