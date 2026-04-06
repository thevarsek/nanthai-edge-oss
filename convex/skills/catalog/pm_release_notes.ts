// convex/skills/catalog/pm_release_notes.ts
// =============================================================================
// System skill: release-notes
// Adapted from product-on-purpose/pm-skills (Apache 2.0) for NanthAI runtime.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const RELEASE_NOTES_SKILL: SystemSkillSeedData = {
  slug: "release-notes",
  name: "Release Notes",
  summary:
    "Create user-facing release notes that communicate new features, improvements, and fixes " +
    "in clear, benefit-focused language. Use when shipping updates to customers or stakeholders.",
  instructionsRaw: `# Release Notes

Release notes communicate product changes to users in a way that highlights value and builds excitement. Unlike changelogs (which document what changed technically), release notes translate changes into user benefits.

## When to Use

- Shipping product updates to customers
- Communicating changes to internal stakeholders
- Preparing app store update descriptions
- Creating changelog entries for documentation
- Summarizing a sprint or release cycle's output

## Instructions

When asked to create release notes, follow these steps:

1. **Gather Changes**
   Collect all changes included in this release: features, improvements, bug fixes, deprecations, and breaking changes. Ask for commit logs, tickets, or PRD references if not provided.

2. **Categorize by Type**
   Group changes into clear categories: New Features, Improvements, Bug Fixes, Breaking Changes, Deprecations. Within each category, order by user impact (most impactful first).

3. **Translate to Benefits**
   Rewrite each change from the user's perspective. Instead of "Added pagination to API endpoint," write "You can now browse large result sets without loading everything at once." Focus on what the user can now do, not what the developer built.

4. **Write Headlines**
   For major features, write a compelling headline and 2-3 sentence description. For smaller improvements and bug fixes, a single sentence suffices.

5. **Add Context Where Needed**
   For breaking changes or deprecations, explain what users need to do. Include migration steps, timelines, and links to documentation.

6. **Choose the Right Tone**
   Match the audience: developer-facing release notes can be more technical; consumer-facing notes should be conversational and benefit-focused. When in doubt, lean toward clarity over cleverness.

## Output Format

### Release Notes — [Product Name] [Version]

**Release Date:** [Date]

#### Highlights
1-3 sentence summary of the most important changes in this release.

#### New Features
- **[Feature Name]** — What it does and why it matters to the user. [1-3 sentences]

#### Improvements
- **[Area]** — What improved and the benefit. [1 sentence]

#### Bug Fixes
- Fixed an issue where [user-visible symptom]. [1 sentence]

#### Breaking Changes (if any)
- **[What changed]** — What users need to do. Migration steps if applicable.

#### Deprecations (if any)
- **[What's deprecated]** — Timeline for removal. Recommended alternative.

## Quality Checklist

- [ ] Changes are categorized (features, improvements, fixes, breaking)
- [ ] Language focuses on user benefits, not implementation
- [ ] Major features have compelling headlines and descriptions
- [ ] Breaking changes include migration guidance
- [ ] Tone matches the target audience
- [ ] No internal jargon or ticket numbers in user-facing notes`,
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
