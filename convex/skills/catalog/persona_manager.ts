// convex/skills/catalog/persona_manager.ts
// =============================================================================
// System skill: persona-manager
// Create and manage NanthAI personas — custom AI personalities with their own
// system prompts, models, and settings.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const PERSONA_MANAGER_SKILL: SystemSkillSeedData = {
  slug: "persona-manager",
  name: "Persona Manager",
  summary:
    "Create or delete NanthAI personas — custom AI personalities with their own system prompt, " +
    "model, and settings. Use when the user wants a specialized assistant personality.",
  instructionsRaw: `# Persona Manager

Create and manage NanthAI personas. A persona is a custom AI personality with its own system prompt, default model, and behavior settings. Personas can be assigned to chats or used as the default for new conversations.

## Available Tools

- **create_persona** — Create a new persona
- **delete_persona** — Delete an existing persona

## When to Use

- "Create a coding persona"
- "Make me a writing assistant"
- "I want a persona that speaks like a pirate"
- "Set up a technical reviewer persona"
- "Delete the marketing persona"
- Any request to create a specialized AI personality

## Creating a Persona

### What to Ask
1. **Purpose** — What should this persona specialize in?
2. **Tone/style** — Formal, casual, terse, verbose?
3. **Model preference** — Any specific model? (optional)

Don't over-ask — infer reasonable defaults from context.

### Writing the System Prompt

The system prompt defines the persona's behavior. Good system prompts:
- State the persona's role and expertise clearly
- Set the tone and communication style
- Include domain-specific knowledge or constraints
- Are concise — under 500 words for most personas

**Good:**
"You are a senior TypeScript engineer. You write clean, well-typed code. Prefer functional patterns over classes. Always consider error handling and edge cases. Keep explanations brief and code-focused."

**Bad:**
"You are a helpful assistant that knows TypeScript." (too vague — adds nothing over the base model)

### Parameters

- **name** — Short, descriptive (e.g., "TypeScript Expert", "Creative Writer")
- **systemPrompt** — The behavioral instructions (see above)
- **description** — One sentence shown in the persona picker
- **modelId** — OpenRouter model ID (optional, defaults to chat model)
- **temperature** — 0.0-2.0 (optional, lower = focused, higher = creative)
- **maxTokens** — Response length limit (optional)
- **avatarEmoji** — Single emoji for the avatar (optional)

### After Creating
Confirm: persona name, what it does, and that it can be selected from the persona picker or assigned to a chat.

## Deleting a Persona

1. Confirm which persona to delete (by name)
2. Call \`delete_persona\`
3. Note: chats that were using this persona will revert to default behavior`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: ["create_persona", "delete_persona"],
  requiredToolProfiles: ["personas"],
  requiredIntegrationIds: [],
};
