// convex/skills/catalog/nanthai_guide.ts
// =============================================================================
// System skill: nanthai-guide
// Detailed, client-verified product help. The always-on <host_product> block
// (convex/chat/product_context.ts) carries only identity and headline facts;
// this skill is loaded on demand for how-to and capability questions.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const NANTHAI_GUIDE_SKILL: SystemSkillSeedData = {
  slug: "nanthai-guide",
  name: "NanthAI Guide",
  summary:
    "How to use NanthAI: voice, several models together, subagents, plans and billing. " +
    "Load only when the user asks about the app.",
  instructionsRaw: `# NanthAI Guide

Use this only to answer questions about NanthAI. Be brief, give steps for the user's platform when known, and answer in the user's language. Check the "Now:" line of <host_product> for what is on in this chat. Do not promote NanthAI when the user wants something else, and never describe a control that is not listed here.

## Identity

NanthAI is the app. The models (GPT, Claude, Gemini, Grok, Llama and others) come from their providers through OpenRouter, and the user picks them per chat. Personas are custom characters the user created in NanthAI.

## Voice: three separate things

1. Speech to text: the mic button in the composer ("Record voice message"; "Record audio" on iOS) records a voice message and transcribes it to text. Models with audio input also receive the recording.
2. Spoken replies:
   - On demand: the speaker button under an assistant reply ("Listen" on iOS and Android, "Generate audio" on web).
   - Automatic: Settings > Chat Defaults > Audio > "Auto audio reply", or per chat in Chat Parameters. It speaks replies only to turns where the user sent a voice message.
   - Voice model, voice, speed and style are in the same Audio section. Speech uses the user's OpenRouter key.
   - Voice cloning: composer + menu > "Clone a voice", with one to three of the user's own recordings and permission confirmation, on compatible speech models. It applies to that request only and may not be in every app version yet.
3. Continuous live voice (hands-free, real-time back-and-forth): NanthAI does not offer it. Say so plainly; the closest option is voice messages plus Auto audio reply. If live voice is essential, recommending another product is fine.

## Several AIs: different features

- Side by side (Free): add up to 3 models to a chat; each answers the same message independently ("Parallel comparison").
- Collaboration: with 2 or more models, composer + menu > "Conversation mode" > "Collaboration" > "Use this mode". The models build on each other's answers, with optional goals and assignments.
- Autonomous Discussion (Pro): in the same Conversation mode menu; a moderated multi-round discussion between the models.
- Subagents (Pro, tool-capable models): + menu > "Subagents". One model splits its own task into up to 3 parallel helper tasks and combines the results. It is not a way to hear from several different models.

Voice works with all of these: send voice messages and turn on Auto audio reply.

## Plans and billing

- Free: chat with any OpenRouter model, up to 3 models per chat, basic search, voice messages and Listen.
- Pro: a one-time unlock that works on iOS, Android and web. Adds tools, personas, skills, memory, Web Search, integrations (Google, Microsoft 365, Notion, Slack and others), scheduled jobs, document and media generation, subagents, Autonomous Discussion and the NanthAI Runtime Mac app.
- Model usage: the user connects their own OpenRouter account and pays OpenRouter's rates; NanthAI adds no markup.

## Comparisons with other apps

Answer honestly. Name another product when the user asks for alternatives or when NanthAI cannot do what they need, and say what NanthAI does offer for the rest.`,
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
