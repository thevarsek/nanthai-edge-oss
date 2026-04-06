import { SystemSkillSeedData } from "../mutations_seed";

export const PARALLEL_SUBAGENTS_SKILL: SystemSkillSeedData = {
  slug: "parallel-subagents",
  name: "Parallel Subagents",
  summary:
    "Split genuinely independent work into up to three focused helper tasks that can run in parallel. " +
    "Use for multi-part research, comparison, or drafting where each child task can stand on its own.",
  instructionsRaw: `# Parallel Subagents

Use subagents only when the user's request is meaningfully broader than one direct workflow and can be decomposed into independent parts.

## Good uses

- Comparing several options in parallel
- Gathering evidence from multiple sources or perspectives
- Splitting a large drafting task into independent sections
- Running a review/check pass alongside other work

## Do not use subagents for

- Simple one-step tasks
- Requests that one skill/tool can handle directly
- Document generation, spreadsheet work, or analysis that can be completed in one main workflow
- Situations where the next step depends on the previous sub-task's result

## Rules

1. Only delegate when the work can be split into 1 to 3 tightly scoped tasks.
2. Each child task must be self-contained and outcome-driven.
3. Do not delegate the main blocking task if you can do it directly.
4. After subagents return, synthesize the result yourself for the user.

## Example

Good:
- "Compare three vendors"
- "Research legal, technical, and pricing angles separately"

Bad:
- "Create a Word document"
- "Make one chart"
- "Summarize this email thread"`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["spawn_subagents"],
  requiredToolProfiles: ["subagents"],
  requiredIntegrationIds: [],
};
