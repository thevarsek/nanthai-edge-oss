# Search guides

Guides are long-form pages under `nanthai.tech/guides` that answer a question people type into Google
("can I use ChatGPT without a subscription", "compare AI answers"). Feature pages explain the app;
guides meet a searcher where they are and show where NanthAI Edge fits. Each guide targets one search
intent and links into the docs for the how-to detail.

Source: `web/content/guides/<slug>.md`. Frontmatter:

```yaml
---
title: Use ChatGPT, Claude and Gemini in one app # what the searcher typed, in plain words; ≤ 60 chars
description: One or two factual sentences. ≤ 155 characters; this is the Google snippet.
keyword: chatgpt claude gemini one app                      # the target search phrase
updated: 2026-10-24
related: [multi-model-chat, byok]             # feature page slugs (/features/<slug>) this guide links to
---
```

## Facts

Every product claim must be traceable to the live site copy: `web/public/llms/edge-*.md` (the
plain-text versions of every public page), `web/src/i18n/locales/en.json` and
`web/src/pages/features/*`. Do NOT use `marketing/PRODUCT.md` (stale since May 2026; e.g. the
model count is now 300+). If the site doesn't say it, the guide doesn't say it. Prices and
counts are copied exactly. Edge is on iOS, Android and the web (nanthai.tech).

Claims about other products (ChatGPT Plus, Claude Pro, Gemini, OpenRouter, Poe, TypingMind, …) must be
checkable on that product's own site or Apple's support pages, dated ("as of October 2026"), and
fair. No "best", no ranking, no digs. When unsure, leave the claim out.

## Voice

Write like a careful person explaining something to a friend who asked. Plain, specific, calm.

- Answer the question in the first two sentences. No warm-up ("In today's fast-paced world…").
- Short paragraphs, real steps, real menu names (Settings › Refine › Engine).
- British spelling, matching the site (capitalise, colour, licence as noun).
- 600–1,100 words. Stop when the question is answered.
- One H1 from the title; H2s phrased as the sub-questions people ask.
- End with a short "Try it" paragraph pointing to the app (https://chat.nanthai.tech or the home page) and one or two feature pages. No hard sell.

Banned (rewrite the sentence, don't swap the word): game-changer, revolutionise, seamless(ly),
effortless(ly), unlock, supercharge, elevate, empower, harness, leverage, delve, dive into,
navigate (figuratively), landscape, realm, robust, cutting-edge, state-of-the-art, powerful,
blazing, magic(al), lightning-fast, next-level, crucial, vital, essential (as filler), "it's
worth noting", "in conclusion", "whether you're X or Y", "say goodbye to", "look no further",
"the best part?", rhetorical questions as hooks, exclamation marks, emojis, em-dash chains,
lists of three adjectives, and sentences of the form "It's not just X, it's Y".

## Linking

- Each guide links to 2–4 feature pages (relative paths like `/features/multi-model-chat`).
- Each related feature page gets a one-line "Guide:" link back at the end (done by the integrator).
- Guides link to each other only when the reader would actually want the next one.

## Publishing and rendering

`npm run build` in `web/` builds the SPA, then extends the existing SEO-shell pipeline
with full article prerendering. `scripts/render-content.tsx` renders the shared React
article page in a static router with English translations and an unloaded auth
provider. Each index and article has both a directory `index.html` and an extensionless
Netlify rewrite to its `.html` variant. The same Markdown sources feed client routes.
Article CSS is linked in the served document, including when JavaScript is disabled.

Guides can add a `topic` frontmatter field to group index cards. Their `related` slugs
automatically supply backlinks on feature pages and their static crawler shells.
`updated` supplies both article dates unless a separate `published` date is present.
The build adds content URLs to `dist/sitemap-edge.xml`, generates Markdown copies in
`dist/llms/`, and includes those copies in `llms.txt` and `llms-full.txt`.

Research lives in `web/content/research/` with `published`, `updated`, `related`,
`description` and an optional local `image` path. Original publication dates are
retained. `scripts/import-linkedin-research.mjs` parses saved LinkedIn HTML without
executing it. Research figure references use `diagram:<article-slug>-<number>`;
the matching data in `web/src/pages/content/*Diagrams.ts` renders as semantic HTML
flows or tables and expands to text in the generated LLM copies. Original source
captions remain in the Markdown. These are historical research articles, rather
than the source for current product claims in guides.

`npm run build` includes `verify-seo-build.mjs`, which checks metadata, complete
article bodies, structured data, sitemap coverage, local images and static variants.
The `content-pages.spec.ts` browser smoke test runs against a built preview with
JavaScript disabled to exercise direct document requests and article links.
