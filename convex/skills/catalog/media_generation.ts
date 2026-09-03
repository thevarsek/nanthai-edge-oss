import { SystemSkillSeedData } from "../mutations_seed";

const BASE = {
  instructionsCompiled: undefined,
  compilationStatus: "compiled" as const,
  scope: "system" as const,
  origin: "nanthaiBuiltin" as const,
  visibility: "visible" as const,
  lockState: "locked" as const,
  status: "active" as const,
  runtimeMode: "toolAugmented" as const,
  requiredIntegrationIds: [],
};

const CREATIVE_DIRECTION = `The prompt anatomy and examples below are generic guidance, not a house style. Apply the active persona's creative direction (for example, cartoon-only artwork) and the user's concrete brief. Never copy example details that were not requested.`;

export const IMAGE_GENERATION_SKILL: SystemSkillSeedData = {
  ...BASE,
  slug: "image-generation",
  name: "Image Generation",
  summary: "Create images from natural-language prompts and attach them to the conversation for reuse in presentations and supported email files or drafts.",
  instructionsRaw: `# Image Generation

Use this skill when the user asks you to create or generate an image.

${CREATIVE_DIRECTION}

## Build the prompt

Write one coherent visual brief using the details already available:

- subject, action, expression, and important objects;
- setting, composition, framing, viewpoint, and focal point;
- medium or visual style, lighting, palette, texture, and mood;
- exact visible wording in quotation marks, plus placement and typography intent;
- exclusions or brand constraints when they matter.

Do not interrogate the user for every field. Preserve supplied details and infer ordinary neutral choices for non-consequential gaps.

Example: \`A friendly editorial vector illustration of a small cobalt paper airplane lifting from an open notebook, three-quarter view with generous cream negative space on the right for a headline, crisp geometric shapes, warm late-afternoon light, cobalt and coral palette, subtle paper texture, no logos, no visible text.\`

## Generate and deliver

- Call generate_image with the complete prompt.
- Chat Defaults supplies the model and baseline parameters. Set model_id only when the user explicitly names a model.
- Include useful generation parameters from the user's request; the backend keeps only values supported by the selected model.
- Make one generation call unless the user explicitly asks for separate variants.
- The tool result is the attachment; do not print its internal storage or temporary download URL.
- You may pass returned image storage IDs to create_presentation assetStorageIds, supported email attachment fields, or connected Drive/OneDrive upload tools.`,
  requiredToolIds: ["generate_image"],
  requiredToolProfiles: ["imageGeneration"],
};

export const MUSIC_GENERATION_SKILL: SystemSkillSeedData = {
  ...BASE,
  slug: "music-generation",
  name: "Music Generation",
  summary: "Generate original music from a creative brief and attach the playable audio to the conversation.",
  instructionsRaw: `# Music Generation

Use this skill when the user asks for original music, a song, an instrumental, a jingle, or a musical clip.

${CREATIVE_DIRECTION}

## Build the prompt

Turn the request into one production brief that covers, when relevant:

- genre, era, references described as traits, and intended use;
- mood, energy, tempo or rhythmic feel, key/tonal character;
- lead and supporting instruments, vocals, language, and exact supplied lyrics;
- structural arc such as intro, build, hook, breakdown, and ending;
- production character, space, dynamics, and mix emphasis.

Do not invent lyrics when the user requested an instrumental. Translate aesthetic references into concrete musical characteristics so the brief remains useful across models.

Example: \`Thirty-second optimistic product-launch instrumental: modern electro-pop at about 112 BPM, bright plucked synth hook, warm bass, tight handclaps and light acoustic guitar, restrained opening, energetic lift at 8 seconds, memorable final sting, polished spacious mix, no vocals.\`

## Generate and deliver

- Call generate_music with the complete production brief.
- Chat Defaults supplies the music model. Set model_id only when the user explicitly names a model.
- Include useful controls from the request; the backend keeps only values supported by the selected model.
- Do not claim that a textual description is generated music; success requires an audio result from the tool.
- Make one generation call unless the user explicitly asks for separate alternatives.
- The tool result is the attachment; do not print its internal storage or temporary download URL.
- A returned storage ID can be attached to a supported email draft or uploaded to connected Drive/OneDrive in the same turn.`,
  requiredToolIds: ["generate_music"],
  requiredToolProfiles: ["musicGeneration"],
};

export const SPEECH_GENERATION_SKILL: SystemSkillSeedData = {
  ...BASE,
  slug: "speech-generation",
  name: "Voice Generation",
  summary: "Turn supplied text into spoken audio using the user's default speech model and preferred voice.",
  instructionsRaw: `# Voice Generation

Use this skill when the user asks for narration, voice-over, spoken audio, or text-to-speech.

${CREATIVE_DIRECTION}

## Prepare the request

- Put only the words that should be spoken in \`text\`, preserving requested wording, language, names, numbers, and pronunciation cues.
- Put delivery direction in \`instructions\`: voice character, audience, emotion, pace, emphasis, pauses, and pronunciation guidance.
- Use \`voice\`, \`speed\`, \`style\`, \`style_degree\`, and \`output_format\` when the user or persona supplies them. The backend projects the request onto controls supported by the selected model.

Example: \`text: "Welcome to NanthAI. Your workspace is ready."; instructions: "Warm, confident product-guide delivery; natural conversational pace; a short pause after NanthAI; lightly emphasize ready."; speed: 0.95.\`

## Generate and deliver

- Call generate_speech with the exact text and the useful delivery controls.
- Chat Defaults supplies the speech model, preferred voice, and baseline controls. Set model_id or voice only when the user explicitly overrides them.
- Do not rewrite, summarize, translate, or add an introduction to text the user asked to be spoken verbatim.
- Make one generation call unless the user explicitly asks for separate voices or takes.
- The tool result is the attachment; do not print its internal storage or temporary download URL.
- A returned storage ID can be attached to a supported email draft or uploaded to connected Drive/OneDrive in the same turn.`,
  requiredToolIds: ["generate_speech"],
  requiredToolProfiles: ["speechGeneration"],
};

export const VIDEO_GENERATION_SKILL: SystemSkillSeedData = {
  ...BASE,
  slug: "video-generation",
  name: "Video Generation",
  summary: "Generate a video from a creative prompt through the user's configured video model and attach it when processing completes.",
  instructionsRaw: `# Video Generation

Use this skill when the user asks you to create or generate a video.

${CREATIVE_DIRECTION}

## Build the prompt

Describe a filmable clip, including when relevant:

- subject continuity, appearance, action, and environment;
- shot sequence or start-to-end change within the requested duration;
- framing, lens feel, camera position and movement;
- lighting, palette, medium/style, motion character, and pacing;
- visible text, exclusions, and sound or silence intent.

Prefer one clear action and camera idea for short clips. Avoid cramming a multi-scene story into a few seconds.

Example: \`Five-second 16:9 cinematic product shot: a cobalt paper airplane rests on a cream desk, then lifts smoothly and glides toward a sunlit window; start macro-close on the folded edge, slow dolly back as it rises, warm natural light, shallow depth of field, subtle paper movement, clean editorial palette, no text or logos, gentle room ambience.\`

## Generate and deliver

- Call generate_video with the complete shot prompt.
- Chat Defaults supplies the model and baseline video parameters. Set model_id only when the user explicitly names a model.
- Include useful video parameters from the user's request; the backend keeps only values supported by the selected model.
- Make one generation call unless the user explicitly asks for separate clips.
- Video generation is asynchronous. Once the tool is accepted, wait for its durable completion instead of calling it again.
- The completed tool result is the attachment; do not print its internal storage or temporary download URL.
- A returned storage ID can be attached to a supported email draft or uploaded to connected Drive/OneDrive in a later tool round.`,
  requiredToolIds: ["generate_video"],
  requiredToolProfiles: ["videoGeneration"],
};
