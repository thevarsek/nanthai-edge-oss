# Technology Stack

> Technologies shipped in the NanthAI Edge OSS repository.

## Stack Overview

| Component | Technology | Version |
|-----------|-----------|---------|
| Web app | Vite + React + TypeScript | Vite 7.3.x, React 19.2.x, TypeScript 5.9.x |
| Styling | Tailwind CSS + utility helpers | Tailwind 3.4.x, `clsx`, `tailwind-merge` |
| Routing | React Router | 7.13.x |
| Auth UI/session | Clerk React SDK | 5.61.x |
| Backend | Convex TypeScript functions | 1.34.x |
| Realtime client | `convex/react` | Convex WebSocket subscriptions, mutations, actions |
| AI SDK | Vercel AI SDK + OpenAI provider | `ai` 5.0.x, `@ai-sdk/openai` 3.0.x |
| Agent runtime | `@convex-dev/agent` | 0.3.x |
| Validation | Convex validators + Zod | Zod 4.3.x |
| Unit/component tests | Vitest + React Testing Library + jsdom | Web package scripts |
| Browser tests | Playwright | `cd web && npm run test:e2e` |
| Backend tests | Node test runner through `tsx` | `npm run convex:test` |

## Web Client

| Area | Technology | Notes |
|------|------------|-------|
| Markdown | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `rehype-highlight` | Chat, ideascapes, and generated content rendering |
| Charts | Recharts | Generated chart display |
| Icons | Lucide React | App controls and route UI |
| PWA | `vite-plugin-pwa`, Workbox | Installability and service worker support |
| i18n | i18next + React bindings | Locale files under `web/src/i18n` |
| SEO/static pages | React Helmet Async | Public feature, privacy, terms, support, and licensing pages |

## Convex Backend

| Area | Technology | Notes |
|------|------------|-------|
| Data | Convex schema split across `schema_tables_*` files | Core, catalog, user, and runtime tables |
| Auth | Clerk JWT provider | Configured in `convex/auth.config.ts` |
| Streaming | Convex actions + `StreamWriter` | Server-side OpenRouter streaming persisted into message state |
| Model catalog | OpenRouter + Artificial Analysis enrichment | Model sync, guidance scoring, image/video catalog helpers |
| Runtime tools | just-bash, Pyodide, Vercel Sandbox | Shell/file workspace, lightweight Python analytics, heavier sandbox execution |
| File generation | `docx`, `pptxgenjs`, custom OOXML readers/writers | DOCX/PPTX/XLSX/text/email generation and extraction |
| Email/Calendar | `imapflow`, `mailparser`, `nodemailer`, `tsdav` | Manual Gmail and Apple Calendar-style CalDAV tooling |
| Push | `web-push`, APNs/FCM helpers | Web push and provider-specific backend delivery helpers |
| Payments | Stripe webhooks/actions | Optional commercial entitlement integration |

## External Integration Pattern

Google Workspace, Microsoft 365, Notion, Slack, Cloze, and calendar/email integrations are implemented as Convex-side tools. Most provider calls use raw `fetch()` to avoid large SDK dependency trees and keep functions compatible with Convex's default runtime where possible.

| Integration | Auth Pattern | Token Storage |
|-------------|-------------|---------------|
| Google Workspace | OAuth 2.0 PKCE with reduced scopes | Convex `oauthConnections` table |
| Microsoft 365 | OAuth 2.0 PKCE public-client flow | Convex `oauthConnections` table |
| Notion | OAuth 2.0 with HTTP Basic token exchange | Convex `oauthConnections` table |
| Slack | OAuth 2.0 workspace tokens + hosted MCP JSON-RPC | Convex `oauthConnections` table |
| Cloze | API key auth | Convex `userSecrets` table |

## Dependency Policy

- Keep product logic in Convex functions; keep the web client as a rendering and interaction layer over shared backend state.
- Prefer raw provider REST calls from Convex tools unless an SDK materially reduces risk or complexity.
- Keep generated Convex files (`convex/_generated/`) out of source control; `npx convex dev` recreates them.
- Treat optional integrations as optional at runtime. The app should run without Stripe, Google, Microsoft, Notion, Slack, Cloze, push, and benchmark-enrichment keys unless that feature is explicitly enabled.

*Last updated: 2026-05-03 — refreshed for the OSS web + Convex checkout.*
