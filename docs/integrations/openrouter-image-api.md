# OpenRouter Images API

Convex owns image-model discovery, request routing, persistence, usage, and
failure normalization. iOS, Android, and web consume the same cached model and
message contracts; clients do not call OpenRouter directly.

Official reference: [OpenRouter Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)

## Discovery

- `GET /api/v1/images/models` is the authoritative image-output catalog.
- `GET /api/v1/images/models/{modelId}/endpoints` enriches each row with
  supported options, input-reference limits, streaming support, and pricing.
- Root-catalog membership alone does not make a model selectable. A model is
  available only when its endpoint-detail request returns at least one endpoint.
  HTTP 404 and a successful empty endpoint list are definitive unavailability.
- A successful non-empty root discovery upserts usable rows. Image-sync-owned
  rows missing a usable endpoint are pruned. A main-catalog hybrid keeps its
  text role but receives `imageCapabilities.isAvailable: false`; that explicit
  flag overrides raw `supportsImages` and image output metadata in every public
  model projection and generation capability lookup.
- A transient endpoint-detail failure (network error, malformed payload, or
  non-404 HTTP failure) skips that model's upsert while keeping its ID active
  for the prune pass, preserving the last known good row.
- Main-catalog multimodal rows keep `managedByImageSync: false`; image sync only
  patches their image-output contract and does not own their chat fields.
- The model-level `supported_parameters` map is a union across providers.
  NanthAI retains every endpoint's definitive parameters, provider slug and
  tag, passthrough allowlist, streaming flag, and pricing. Until OpenRouter
  documents endpoint pinning for Images requests, the effective capability map
  exposed to clients is the conservative intersection across every current
  endpoint. A parameter missing from any endpoint is unavailable; enum values
  and numeric ranges are intersected. Input-reference limits, streaming, and
  passthrough parameters follow the same endpoint-safe policy.

Pricing units remain explicit. Token prices populate legacy token fields,
direct image prices populate `pricePerImage`, megapixel prices populate
`pricePerMegapixel`, and the raw typed pricing lines remain available. Never
multiply a per-image or per-megapixel price as though it were a token rate.
Missing or unusual pricing never makes a model unavailable; picker pricing is
omitted when OpenRouter does not advertise a usable positive billing line.

## Shared capability projection

`listModels`, `getModel`, and `listModelSummaries` all include the same derived
`mediaCapabilities` object. Its optional `image` member exposes count bounds,
aspect ratios, resolutions, sizes, qualities, backgrounds, output formats,
input-reference limit, and streaming support. Its optional `video` member
exposes resolutions, aspect ratios, durations, frame image roles, audio
support, and seed support. List-valued fields are always arrays, including when
empty. An absent media member means that generation modality is unavailable.

## Generation

Every output-image model uses `POST /api/v1/images`:

```json
{
  "model": "openai/gpt-image-2",
  "prompt": "A studio portrait of a tabby cat",
  "input_references": [
    { "type": "image_url", "image_url": { "url": "https://example.com/ref.png" } }
  ]
}
```

Because the Images API accepts one prompt rather than chat-role messages,
Convex projects the selected branch into a bounded prompt. Applicable system,
persona, and memory guidance is followed by recent branch-local user/assistant
text in chronological order, then the current user request verbatim and last.
The context prefix is capped at 12,000 characters without truncating the current
request. Image data URLs, base64 payloads, generated-image sentinels, and the
autonomous synthetic visual-context label are excluded from text projection;
the actual images travel only through `input_references`.

`input_references` is resolved from the selected branch transcript, deduplicated,
and capped by the cached model descriptor. Images on the current user turn come
first, so an explicit attachment wins when a model accepts only one reference.
Images from explicitly selected Ideascape parents are pinned to that current
turn; each selected lineage contributes its nearest valid visual node, even
when two branches used the same model. Remaining branch-local visual context is
considered newest-turn-first. This keeps a generated image available after an
intervening text-model response while excluding inactive branches. Failed and
cancelled image outputs are never used as references.

Autonomous assistant-to-assistant edges project the latest generated image into
a synthetic user context turn before the autonomous transcript is assembled.
Successful response bodies are parsed one `data[]` item at a time. Convex
back-pressures the upstream stream while each base64 image is decoded and
persisted, so a ten-image response never requires all ten encoded and decoded
images to coexist in action memory. Image participants are always delegated to
the Node action runtime. A 32 MiB decoded-image ceiling and a matching streamed
JSON-object guard reject an individually oversized item before parsing or
allocating its decoded bytes. This internal transport ceiling is independent
of the user-selected count and resolution. This bounded transport is
why NanthAI does not impose a second product-level count/resolution
compatibility matrix on top of the model capabilities advertised by
OpenRouter.

Each persisted image is added to `generatedMedia` and published through the
assistant message's aligned `imageUrls` and `imageMimeTypes` arrays.
`imageMimeTypes[index]` describes `imageUrls[index]`, including opaque Convex
storage URLs and SVG output. SVG is always served from storage rather than
embedded in a message document. Generated-media rows retain the effective
model and prompt for Knowledge Base attribution.

The message also exposes an optional terminal summary:

```json
{
  "imageGenerationResult": {
    "requestedCount": 4,
    "generatedCount": 3,
    "failedCount": 1
  }
}
```

If at least one image is safely stored, a later malformed, oversized, failed,
or interrupted output item produces a completed partial result instead of
discarding the successful images. Zero stored images remains a failed
generation. Clients render the same localized partial-success summary from
this backend-authored count contract.

The primary chat and autonomous-discussion paths share this dispatcher. Job
cancellation is checked before each image is stored and again before media
rows/message publication. Blobs written during a cancellation race are deleted
best-effort, so a cancelled image is never published as completed.

## Capability-aware defaults

`userPreferences` and `preferences:upsertPreferences` expose seven optional
cross-client defaults:

- `defaultImageCount` (integer 1–10)
- `defaultImageAspectRatio`
- `defaultImageResolution`
- `defaultImageQuality` (`auto`, `low`, `medium`, or `high`)
- `defaultImageBackground` (`auto`, `opaque`, or `transparent`)
- `defaultImageOutputFormat` (`auto`, `png`, `jpeg`, or `webp`)
- `defaultImageOutputCompression` (integer 0–100)

Clients may edit these generic preferences, using `null` to clear one, but must
not compose an OpenRouter request or send an `imageConfig` with an ordinary
message. Convex captures the current defaults as a backend-owned `imageConfig`
inside the assistant message's retry contract. A retry reuses that snapshot;
legacy turns without one fall back to the user's current preferences.

At generation time Convex intersects the snapshot with the selected model's
`imageCapabilities.supportedParameters`. Blank or `auto` values are omitted.
Counts and compression are integer-clamped to advertised ranges. Enum values
must be advertised; aspect ratio chooses the closest parseable ratio;
resolution chooses the nearest lower tier, then the nearest higher tier; and
quality chooses the nearest `low`/`medium`/`high` level, preferring the lower
level on a tie. Unsupported fields are never sent.

The resulting request may include `n`, `aspect_ratio`, `resolution`, `quality`,
`background`, `output_format`, and `output_compression`. If a future model
advertises `size` but not `resolution`, the selected resolution tier is sent as
`size`; the two fields are never sent together. Compression is omitted for PNG.
An explicit transparent/JPEG combination is changed to supported PNG, then
WebP, or has transparency omitted when neither safe format is advertised.
Unknown capability keys, `seed`, and `stream` are ignored. Provider-specific
options are not exposed as global defaults; omitted fields still use the
selected model/provider defaults.

OpenRouter currently documents `provider.options` for image passthrough, but
its Images request schema does not expose the Chat Completions routing fields
(`require_parameters`, `only`, or `order`) needed to pin the endpoint whose
capability record matched a selection. NanthAI therefore exposes only the
endpoint intersection and does not add undocumented provider-routing fields.
The full endpoint records remain cached so the policy can become endpoint-aware
if OpenRouter later documents request-side `provider_tag` selection.

All safely persisted images returned for `n > 1` are attached to the same
assistant message. The request count is bounded by the endpoint-safe model
capability (and the generic 1–10 preference range); unsupported parameters are
dropped or adapted by the backend as described above.

## Routing Safety

- Image-output models never go to `/chat/completions`; the transport rejects an
  image modality if a caller bypasses the dispatcher.
- Text-only orchestration (search/research synthesis and subagents) rejects an
  image model with a structured, user-facing error.
- Configurable ancillary text work (titles and memory extraction/import) falls
  back to its known text default when the selected model produces image, video,
  or audio output, is missing, or cannot be resolved.
- Image generation has no text fallback. Empty image payloads, timeouts, and
  provider errors remain failures and are normalized before persistence.
- The Images API does not expose an enforceable `provider.zdr` contract.
  Image generation therefore rejects ZDR and Google-protected turns before any
  request leaves Convex.

## Analytics

Terminal `assistant_response_completed` / `assistant_response_failed` events
use `source: "image_generation"` and include the effective `model_id`.
Completed events include `requested_image_count`, `image_count`,
`image_failed_count`, and `image_partial_success`, so PostHog can distinguish a
complete multi-image result from a useful partial result without inspecting
message content.
