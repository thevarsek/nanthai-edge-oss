# NanthAI Edge Marketing Video Standards

> Repository-specific defaults for HyperFrames product and marketing videos.
> HyperFrames skills remain the source of truth for framework mechanics; this
> document owns NanthAI's visual, editorial, audio, capture, and delivery
> decisions.

## Purpose

NanthAI marketing videos should feel like parts of one campaign even when they
cover different features. The consistent impression is:

- real product proof rather than invented AI imagery;
- clean, optimistic, and human rather than theatrical;
- one product across iOS, Android, and web;
- energetic motion that never competes with comprehension; and
- polished audio with an approachable narrator and an audible musical identity.

These are defaults, not a reason to ignore a campaign brief. Record intentional
departures in the project's `BRIEF.md` before production.

## Source of Truth

1. Use current UI captured from the repository's running clients:
   `NanthAi-Edge/`, `android/`, and `web/`.
2. Do not redraw, approximate, or fabricate product screens.
3. Use the shipped NanthAI logo, monogram, icons, design tokens, and product
   typography.
4. Capture the clients at their normal production scale and text size. Remove
   simulator controls, emulator notifications, debug overlays, and test data
   that would distract from the product.
5. When a claim is cross-platform, show at least two platforms and prefer the
   iOS + Android + web proof set. Feature-specific films may use only the
   relevant surface.
6. Recapture a surface when the product UI has materially changed. Do not keep
   using an attractive but stale screen.

## Default Format and Safe Area

| Property | Default |
|---|---|
| Master | 1920 × 1080, landscape |
| Frame rate | 30 fps |
| Typical duration | 30–60 seconds; 45 seconds for a product introduction |
| Delivery | Website and LinkedIn |
| Square-safe area | Central 1080 × 1080 region |
| Square-safe margins | 420 px on the left and right of a 1920 px master |
| Final codec | H.264 video + AAC 48 kHz stereo audio |

Keep the logo, core product proof, headlines, captions, and CTA inside the
square-safe region. Decorative elements and device edges may extend beyond it.

## Visual Language

### Palette

| Role | Value |
|---|---|
| Canvas | `#FFFFFF` |
| Primary ink | `#050507` |
| NanthAI coral | `#FF6B3D` |
| Secondary ink | `#6A717F` |
| Subtitle rail | `rgba(5, 5, 7, 0.92)` |

Use coral as an accent and motion cue, not as a full-screen wash. Prefer a
bright canvas, generous negative space, and restrained shadows.

### Typography

- Use a bundled render-stable sans serif. Prefer Roboto in HyperFrames output
  when the composition would otherwise rely on a system-font alias.
- Headlines should be concise, high-contrast, and visually heavier than body
  copy.
- Do not reproduce paragraphs from the product UI as marketing copy.
- Keep essential text within the square-safe area.

### Product surfaces

- Treat device and browser frames as supporting structure; the real UI remains
  the focal point.
- Use the same visual scale for equivalent iOS and Android moments.
- Avoid generic AI brains, neon circuitry, fake dashboards, stock people, and
  sci-fi interface decoration.
- Let Ideascapes provide the visual climax when spatial thinking is part of the
  story.

## Motion Language

Use a small recurring transition vocabulary:

- directional push for continuity between product surfaces;
- zoom-through for expansion or a change in conceptual scale;
- short blur crossfade for the final resolution; and
- subtle parallax or scale drift within a held product shot.

Typical transitions are `0.48–0.62s`. Motion should be responsive and smooth,
with one clear focal action at a time.

### No pre-animation flash

Delayed GSAP `fromTo` animations can briefly show an element in its finished
CSS state before the animation begins. Seed every delayed entrance at time zero
and animate to the final state:

```js
const enter = (selector, from, to, at) => {
    timeline.set(selector, from, 0);
    timeline.to(selector, to, at);
};
```

Do not use a delayed `fromTo(..., { immediateRender: false }, at)` for a visible
entrance unless the element's authored CSS already matches the hidden start
state. Inspect the first frame and the first half-second of every new scene.

### Timeline furniture

- Do not show `02 / 07`-style scene counters.
- A progress line is optional. When used, it must be one persistent global
  element that animates linearly from 0–100% across the complete film.
- Never use per-scene progress widths that jump at transitions.

## Narration and Captions

### Narration

Default to the full OpenAI `openai/gpt-audio` model through OpenRouter with the
`coral` voice.

Voice direction:

- bright, cheerful young woman;
- natural British-neutral delivery;
- friendly and genuinely enthusiastic;
- conversational rather than announcer-like; and
- lively without becoming sugary, breathless, or overly promotional.

Generate narration per scene so pauses can be placed against the edit without
unnatural time-stretching. Preserve the exact approved script and verify the
returned transcript.

### Captions

Captions are always present unless the destination explicitly forbids them.
Use a consistent high-contrast rail:

- white text on `rgba(5, 5, 7, 0.92)`;
- approximately 28 px at 1080p;
- maximum two balanced lines;
- 18 px corner radius;
- approximately 36 px above the bottom edge; and
- fully inside the central square-safe area.

The rail may cover non-essential detail, but must not obscure the feature being
demonstrated. Captions appear at full contrast; avoid long opacity fades that
temporarily fail accessibility contrast.

## Music and Mix

Use Google `google/lyria-3-pro-preview` through OpenRouter as the default music
model. Give it the approved storyboard contact sheet and a timestamped
structural prompt.

Default musical direction:

- instrumental, no vocals or spoken words;
- approximately 112 BPM;
- upbeat premium product-film energy;
- warm synth pulse, playful arpeggios, glass textures, rounded bass, and crisp
  restrained percussion;
- a clear lift for the conceptual climax; and
- a clean, warm resolution under the CTA.

Keep the narrator centred and move the music outward in the stereo field.
Current reference mix:

| Stage | Target or setting |
|---|---|
| Narration | approximately `-17 LUFS`, mono-centred |
| Music bed | approximately `-18.3 LUFS` before final mix |
| Music width | `stereotools=mlev=0.72:slev=1.35` |
| Voice ducking | gentle; approximately `ratio=1.65`, `threshold=0.05` |
| Final master | approximately `-14.5 LUFS` |
| True-peak ceiling | `-1.5 dBFS` |

The music must remain audible during narration. Sidechain compression should
create space, not make the score disappear.

## Production Workflow

1. Read `videos/AGENTS.md` and this guide.
2. Write `BRIEF.md`, including any intentional standard overrides.
3. Build a storyboard and narration script.
4. Build and inspect the current iOS, Android, and web clients before capture.
5. Capture real UI and assemble the HyperFrames composition.
6. Generate narration and music without storing API keys in the repository.
7. Master a replaceable voice stem, music stem, and final stereo mix.
8. Run `npm run check` and resolve all errors and warnings.
9. Obtain explicit approval of the final Studio preview.
10. Render with `--quality high`.
11. Verify the MP4 with `ffprobe` and a complete FFmpeg decode.

## Repository and Release Policy

- Put new HyperFrames work under `videos/<project-slug>/`.
- Do not bulk-stage a generated or experimental `videos/` tree. Stage only
  intentional source, policy, and licensed assets.
- Do not commit API keys, `.env` files, provider responses containing secrets,
  preview caches, generated browser binaries, or final delivery renders.
- Store final marketing exports outside the repository unless a tracked
  distribution location is explicitly approved.
- Marketing documentation, compositions, and media-only changes do not require
  an iOS or Android version bump.
- If producing the video requires a real app code or resource change, the
  normal platform build, test, lint, and versioning rules apply to that change.

## Definition of Done

- Real product UI is used and is current.
- The core story is understandable with audio muted.
- Captions pass WCAG AA contrast and remain inside the safe area.
- No scene shows its finished pose before its entrance animation.
- Music remains audible while narration stays intelligible.
- Runtime, layout, motion, and contrast checks pass without errors or warnings.
- The user approves the final Studio preview.
- The rendered MP4 has the intended duration, dimensions, frame rate, and
  stereo audio, and decodes without errors.
