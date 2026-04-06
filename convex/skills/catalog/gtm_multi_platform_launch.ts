// convex/skills/catalog/gtm_multi_platform_launch.ts
// =============================================================================
// System skill: multi-platform-launch
// Adapted from chadboyda/agent-gtm-skills (MIT) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const MULTI_PLATFORM_LAUNCH_SKILL: SystemSkillSeedData = {
  slug: "multi-platform-launch",
  name: "Product Launch",
  summary:
    "Plan and execute multi-channel product launches. Covers launch strategy across Product Hunt, " +
    "social media, communities, email, PR, and paid channels with timeline and checklist.",
  instructionsRaw: `# Product Launch — Multi-Platform Strategy

Plan and execute product launches across multiple channels with coordinated timing, messaging, and follow-through.

## When to Use

- Launching a new product, feature, or major update
- Entering a new market or vertical
- Re-launching after a pivot or rebrand
- Planning a beta-to-GA transition
- Coordinating a multi-channel announcement

## Instructions

When asked to plan a product launch, follow these steps:

1. **Define Launch Tier**
   Classify the launch to set the right level of effort:
   - **Tier 1 (Major):** New product, new market entry, rebrand. All channels, 4-6 week prep.
   - **Tier 2 (Feature):** Significant feature release, pricing change. Select channels, 2-3 week prep.
   - **Tier 3 (Minor):** Bug fixes, small improvements. Blog post + changelog, 1 week prep.

2. **Nail the Core Messaging**
   Before touching any channel, define:
   - **One-liner:** What is it and who is it for? (Under 15 words.)
   - **Problem statement:** What pain does this solve?
   - **Key benefits:** 3 concrete outcomes, not features.
   - **Social proof / traction hook:** Any numbers, testimonials, or credibility signals.

3. **Build the Channel Plan**
   Select channels based on where your audience actually is. For each channel, define the format, timing, and goal.

   **Product Hunt:**
   - Secure a credible hunter or self-hunt with a strong maker profile.
   - Prepare: tagline (60 chars), description, 4-6 gallery images/GIF, first comment with backstory.
   - Launch at 12:01 AM PT on Tuesday–Thursday. Engage every comment within 30 minutes.
   - Goal: Top 5 of the day, email subscriber capture.

   **Hacker News:**
   - Write a "Show HN" post: concise, technical, honest about tradeoffs.
   - Post between 8-10 AM ET on weekdays. Respond to every comment thoughtfully.
   - Never ask for upvotes. Let the work speak.

   **Twitter/X:**
   - Thread format: hook tweet → problem → solution → proof → CTA.
   - Schedule for 9 AM ET and 2 PM ET. Use visuals on every tweet.
   - Engage with every reply for the first 2 hours.

   **LinkedIn:**
   - Personal narrative format works best. Lead with insight, not announcement.
   - Post from founder's personal account, not company page.
   - Optimal times: Tuesday–Thursday, 8-10 AM local time.

   **Reddit:**
   - Post only in communities you already participate in.
   - Lead with value, not promotion. Share what you learned building it.
   - Never cross-post the same content to multiple subreddits.

   **Email List:**
   - Segment by engagement level. Warm subscribers get early access.
   - Send sequence: teaser (T-7), launch day announcement, follow-up with social proof (T+3).

   **Communities (Discord, Slack, Indie Hackers, etc.):**
   - Only share in communities where you're an active member.
   - Frame as "here's what I built" not "check out my product."

4. **Build the Launch Timeline**

   | Milestone | Actions |
   |-----------|---------|
   | **T-30** | Finalize messaging. Start building email waitlist. Prep visual assets. |
   | **T-14** | Draft all channel-specific copy. Line up hunter/supporters. Start teaser content. |
   | **T-7** | Send teaser email. Seed interest in communities. Final asset review. |
   | **T-1** | Pre-schedule social posts. Brief any supporters. Test all links and landing pages. |
   | **Launch Day** | Execute channel plan in sequence. Monitor and respond to every mention. |
   | **T+1** | Share results and social proof. Thank supporters publicly. |
   | **T+7** | Post-launch retrospective. Capture learnings. Nurture new leads. |

5. **Waitlist & Pre-Launch Building**
   - Create a simple landing page with email capture before launch.
   - Offer early access, exclusive pricing, or input on features as incentive.
   - Nurture waitlist with 2-3 build-in-public updates before launch.
   - Convert waitlist to day-one users and social proof.

6. **Post-Launch Follow-Through**
   Most launches fail not on day one, but in the week after. Plan:
   - Daily social engagement for 7 days post-launch.
   - Follow-up content: customer stories, usage data, lessons learned.
   - Retarget launch visitors who didn't convert.

## Output Format

### [Product Name] Launch Plan

**Launch Date:** [Date]
**Launch Tier:** [1/2/3]
**Primary Goal:** [Signups / Revenue / Awareness / Waitlist]

#### Core Messaging
- **One-liner:** ...
- **Problem:** ...
- **Benefits:** 1) ... 2) ... 3) ...
- **Proof:** ...

#### Channel Plan
| Channel | Format | Timing | Owner | Goal |
|---------|--------|--------|-------|------|
| ... | ... | ... | ... | ... |

#### Launch Timeline
Detailed week-by-week breakdown with owners and deliverables.

#### Waitlist Strategy
How you'll build and nurture pre-launch interest.

#### Post-Launch Plan
Day-by-day actions for the first week after launch.

## Quality Checklist

- [ ] Launch tier is defined and effort is proportional
- [ ] Core messaging is clear, concise, and benefit-oriented
- [ ] Channel selection matches where the target audience actually is
- [ ] Each channel has specific format, timing, and engagement plan
- [ ] Timeline covers pre-launch, launch day, and post-launch
- [ ] All links, landing pages, and assets are tested
- [ ] Post-launch follow-through is planned, not an afterthought
- [ ] Metrics and success criteria are defined upfront`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [],
  requiredToolProfiles: [],
  requiredIntegrationIds: [],
};
