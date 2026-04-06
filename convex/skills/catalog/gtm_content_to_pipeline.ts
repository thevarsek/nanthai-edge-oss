// convex/skills/catalog/gtm_content_to_pipeline.ts
// =============================================================================
// System skill: content-to-pipeline
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const CONTENT_TO_PIPELINE_SKILL: SystemSkillSeedData = {
  slug: "content-to-pipeline",
  name: "Content to Pipeline",
  summary:
    "Build a content-led growth strategy that turns content into qualified pipeline. Covers content " +
    "distribution, multi-platform repurposing, newsletter strategy, and content-to-conversion funnels.",
  instructionsRaw: `# Content to Pipeline

Help the user build a content strategy that generates qualified pipeline — not just traffic. Every piece of content should have a clear path to a conversion event.

## When to Use

- Starting a content marketing function from scratch
- Content gets traffic but doesn't generate pipeline
- Need to improve content ROI and attribution
- Building a distribution engine for existing content
- Designing a newsletter as a pipeline channel

## Core Principle: Distribution-First

Most content fails because it's created before distribution is planned. Reverse the process:

1. **Start with the channel** — Where does your ICP actually spend time?
2. **Design for the format** — What performs on that channel? (Thread, short post, long-form, video clip)
3. **Work backward to the source piece** — What anchor content produces all these formats?

Never create content and then figure out where to post it.

## Step 1 — Content-Channel Fit Matrix

Map your ICP's attention to channels:

| Channel Category | Examples | Best Content Type | Engagement Pattern |
|-----------------|----------|-------------------|-------------------|
| Professional social | LinkedIn, X/Twitter | Short-form opinion, data drops, frameworks | Daily scroll, quick engagement |
| Community / forum | Industry Slack groups, Reddit, Discord | Tactical advice, AMAs, teardowns | Problem-seeking, trust-building |
| Search / SEO | Blog, docs, YouTube | How-to guides, comparison pages, tutorials | Intent-driven, high conversion |
| Email / newsletter | Owned list | Curated insights, original research, POV | Regular cadence, deepest trust |
| Audio / video | Podcast, YouTube, webinar | Interviews, deep dives, live Q&A | Long attention, relationship-building |

Ask the user where their ICP is most active, then design the content strategy around those 2-3 primary channels.

## Step 2 — The 1→10 Repurposing System

One anchor piece of content should produce 10+ distribution assets:

### Anchor Piece (1)
A long-form, high-value piece: original research report, comprehensive guide, webinar recording, or podcast episode (1,500-3,000 words or 30-60 min).

### Derivative Assets (10+)
| # | Asset | Channel | Time to Create |
|---|-------|---------|---------------|
| 1 | Blog post (full) | SEO / website | 30 min (edit from transcript/draft) |
| 2 | Executive summary | Newsletter | 15 min |
| 3 | Thread (5-8 posts) | Social media | 20 min |
| 4 | Single-insight post × 3 | Social media | 10 min each |
| 5 | Quote graphic × 2 | Social media / community | 10 min each |
| 6 | Short video clip (60-90s) | Social / video platform | 15 min |
| 7 | Email to prospects | Outbound sequence | 10 min |
| 8 | Community post / answer | Forum / Slack group | 10 min |
| 9 | Internal enablement doc | Sales team | 15 min |
| 10 | Slide deck (5-7 slides) | Presentations / social | 20 min |

Total time: ~3 hours to produce 10+ assets from one anchor piece.

## Step 3 — Content → Conversion Funnel

Every content piece must connect to a conversion event. Design the funnel:

### Top of Funnel (Awareness)
- **Content:** Social posts, SEO articles, podcast appearances
- **Goal:** Earn attention and build trust
- **Conversion:** Newsletter signup, content download, follow
- **Metric:** Subscriber growth rate, social engagement rate

### Middle of Funnel (Consideration)
- **Content:** Case studies, comparison guides, webinars, teardowns
- **Goal:** Prove you understand their problem and have a solution
- **Conversion:** Demo request, free trial, consultation booking
- **Metric:** Content-attributed pipeline created ($)

### Bottom of Funnel (Decision)
- **Content:** ROI calculators, implementation guides, customer stories
- **Goal:** Reduce risk and remove objections
- **Conversion:** Closed deal
- **Metric:** Content-influenced revenue ($)

### The Attribution Link
For each content piece, define:
- Primary CTA (what you want the reader to do next)
- Tracking mechanism (UTM, dedicated landing page, unique link)
- Handoff to sales (when does content-qualified become sales-qualified?)

## Step 4 — Newsletter as Pipeline Engine

A newsletter is the highest-ROI content channel because you own the audience. Design it to drive pipeline:

### Structure
- **Frequency:** Weekly or biweekly (consistency > frequency)
- **Length:** 500-800 words (respect inbox time)
- **Format:** 1 big idea + 2-3 supporting links + 1 CTA
- **Voice:** Opinionated, specific, useful — not a company blog digest

### Growth Levers
- Cross-promote in every content piece (social, blog, podcast)
- Referral program (subscriber invites subscriber)
- Co-promotions with complementary newsletters
- Gated content upgrades (deeper resource in exchange for email)

### Pipeline Connection
- Track which subscribers engage most (opens, clicks, replies)
- Route high-engagement subscribers to sales as warm leads
- Include soft CTAs monthly (not every issue): "Want help with this? We do exactly this."
- Use reply-to as a signal — anyone who replies is a hot lead

## Step 5 — Content Calendar & Execution

### Weekly Cadence
| Day | Activity | Output |
|-----|----------|--------|
| Monday | Create anchor content | 1 long-form piece |
| Tuesday | Repurpose into derivative assets | 3-4 social posts, 1 email |
| Wednesday | Distribute to communities + forums | 2-3 posts |
| Thursday | Newsletter edition | 1 newsletter |
| Friday | Engage (reply to comments, DMs, threads) | Relationship-building |

### Monthly Review
- Which content generated the most pipeline (not just traffic)?
- Which channels had the best conversion rate?
- What topics got the most engagement from ICP (not general audience)?
- Double down on what works, cut what doesn't.

## Output Format

1. **Channel Strategy** — Top 2-3 channels with rationale
2. **Anchor Content Plan** — Next 4 anchor pieces with titles, formats, and target personas
3. **Repurposing Matrix** — 1→10 breakdown for the first anchor piece
4. **Conversion Funnel** — Full funnel with CTAs and tracking per stage
5. **Newsletter Blueprint** — Format, cadence, growth plan, pipeline connection
6. **Content Calendar** — 4-week calendar with daily activities

## Quality Checklist

Before delivering, verify:
- [ ] Every content piece has a defined distribution channel (no orphan content)
- [ ] Every content piece has a clear CTA that connects to pipeline
- [ ] The funnel has measurable conversion events at each stage
- [ ] Newsletter strategy includes both growth and pipeline-generation tactics
- [ ] Content topics are derived from ICP pain points, not company talking points
- [ ] The calendar is realistic for the user's team size and resources
- [ ] No references to specific tools — strategy is platform-agnostic`,
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
