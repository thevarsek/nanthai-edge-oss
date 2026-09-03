import { SystemSkillSeedData } from "../mutations_seed";

export const PPTX_SKILL: SystemSkillSeedData = {
  slug: "pptx",
  name: "Presentations",
  summary:
    "Create and iteratively edit polished, downloadable presentations inside the normal chat flow, or interpret attached PowerPoint decks.",
  instructionsRaw: `# Presentation Skill

Presentations are part of the normal NanthAI conversation. Never send the user to a separate presentation mode, route, library, or studio.

## Multi-participant and Ideascape safety

Reading and reviewing presentations may use multiple participants. Creating or editing a presentation requires one participant. If more than one participant is active, do not claim a write succeeded; tell the user: "Presentation and Word document creation or editing require a single participant. Open + → Participants and remove participants until only one remains, then try again. You can add the others back afterward."

Ideascape may open presentation artifacts for review, but existing presentation edits stay in normal chat. Ask the user to open the artifact, return to Chat, and stage the slide or element there.

## Clarify before creating

Before calling create_presentation, resolve the brief through ordinary chat. Ask only for information the user has not already supplied, covering:

1. audience and their level of subject knowledge;
2. tone and technicality (for example technical, non-technical, executive, educational/divulgative, persuasive, or another user-defined style);
3. purpose and the outcome the audience should leave with;
4. approximate length;
5. examples or a reference presentation when useful;
6. brand assets, images, charts, or other material to reuse;
7. one final check for any consequential ambiguity.

Do not silently invent audience or tone. Keep the questions proportional: acknowledge details already supplied and ask a compact grouped question when practical. The user may answer in free text and may attach files.

Presentation creation supports 1 to 20 slides. If the user asks for more than 20, explain the current limit and ask them to consolidate or choose a supported length before calling create_presentation. Never submit an unsupported count and let generation fail later.

## Tools and workflow

- create_presentation creates the canonical safe HTML presentation, stores stable slide and element IDs with revisions, and returns a real PPTX generated file for the chat.
- read_presentation reads the latest presentation in this chat or a selected project/slide, including canonical HTML and revisions.
- edit_presentation makes a scoped revision-safe change to one slide or data-element-id and returns an updated real PPTX.
- read_pptx inspects an externally attached PPTX. Treat imports as references to interpret and rebuild; do not promise lossless round-trip editing.

For a new presentation:

1. Clarify the missing brief fields.
2. If a reference PPTX is attached, call read_pptx first and summarize its layout, normalized geometry, theme, text, notes, and image traits in referenceNotes.
3. Call create_presentation with the resolved brief, audience, tone, and an explicit slideCount when length is known. If you showed the user a slide-by-slide outline and they approved it, pass it as approvedOutline so generation preserves its count, order, and topic intent instead of silently planning a different deck. When the user's request contains factual source text, stories, figures, or labels, pass that material in sourceContent instead of reducing it to a generic summary; this is especially important when clarification happened in a later turn. sourceStorageId is used for an attached source PPTX rebuild. For a rebuild, pass reusable referenceImages[].storageId values in assetStorageIds. Attached and generated user-owned images can also be passed in assetStorageIds; the backend safely deduplicates a repeated image reference.
4. Tell the user the generated file is ready without exposing internal HTML or project IDs. Do not print or paste a direct storage/download URL: the generated-file card and its side panel are the authoritative delivery and download surfaces.

Never fall back to generate_pptx or edit_pptx. Those legacy file-only tools do not create the revisioned HTML project or interactive side panel. A deferred create_presentation failure has already exhausted bounded backend repair attempts: report it and do not start another presentation project in the same user turn. You may correct and retry once only when the tool failed immediately because its arguments were invalid before generation began.

For a follow-up change:

1. Use the hidden presentation context supplied with the user's message when present.
2. Otherwise call read_presentation with the project ID mentioned in prior tool context, or omit it to resolve the latest ready presentation in this chat.
3. Call edit_presentation for surgical changes. Pass slideId and elementId when selected, plus known revisions.
4. Preserve all unrequested slides and elements. Regenerate the whole presentation only when the user explicitly asks to start over.

Use title-as-takeaway, one primary message per slide, accessible contrast, coherent narrative, useful speaker notes, varied compositions, restrained text density, and visuals or geometry that clarify rather than decorate.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "anthropicCurated",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "create_presentation",
    "read_presentation",
    "edit_presentation",
    "read_pptx",
  ],
  requiredToolProfiles: ["presentations"],
  requiredIntegrationIds: [],
};
