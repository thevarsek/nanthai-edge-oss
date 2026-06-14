# NanthAI Edge

> Source-available AI workspace: React/Vite web client plus Convex backend for multi-model chat, personas, memory, tools, scheduled jobs, documents, integrations, runtime tools, and per-user OpenRouter keys.

[![License: Source-Available](https://img.shields.io/badge/License-Source--Available-blue)](/LICENSE)

## What Is This?

NanthAI Edge is a production-grade AI chat/workspace app you can study, run, and adapt. The OSS repository contains the **web client** and **Convex backend**. Native mobile apps live in the private/commercial sibling repo, while this checkout focuses on the self-hostable browser experience and shared product API.

Every user brings their own OpenRouter account through OAuth PKCE. There is no shared server-side OpenRouter key and no hidden inference bill for the host.

## What You Get

- **Multi-model chat** - send a turn to multiple models and compare responses side by side.
- **Personas** - custom assistants with model, prompt, parameter, skill, and integration defaults.
- **Ideascapes** - branch-aware conversations rendered as a spatial canvas.
- **AI Skills** - progressive skill loading with built-in and user-authored skills.
- **Internet search and research** - web-search and research-paper flows backed by Convex state.
- **Memory** - extraction, approval, vector retrieval, persona scoping, and import workflows.
- **Document workflows** - generate, read, edit, cite, and attach DOCX/PPTX/XLSX/text/email-style artifacts.
- **Audio and media** - audio message metadata, TTS playback support, Lyria music output, video generation, generated files, and native chart payloads.
- **Scheduled jobs** - recurring AI tasks with multi-step pipelines and API trigger tokens.
- **Integrations** - Google Workspace, Microsoft 365, Notion, Slack, Cloze, Apple Calendar, and Manual Gmail patterns.
- **Runtime tools** - just-bash workspace, Pyodide analytics, and optional Vercel Sandbox execution.

## Why Use It?

| Use case | Why it fits |
|----------|-------------|
| Self-hosted AI workspace | Run the web app and Convex backend with your own auth, domain, and user-provided AI keys |
| AI product reference app | Study real streaming, tools, memory, OAuth, files, search, scheduled jobs, and document workflows |
| Team or client prototype | Start from a complete app instead of wiring auth, storage, streaming, and model selection from scratch |
| Convex + AI learning | Backend is organized around schema files, queries, mutations, actions, crons, HTTP routes, and contract tests |

## Self-Hosting Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- A [Convex](https://convex.dev) account
- A [Clerk](https://clerk.com) account
- An [OpenRouter](https://openrouter.ai) account for each user

### 1. Clone and install

```bash
git clone https://github.com/thevarsek/nanthai-edge-oss.git
cd nanthai-edge-oss
npm install
cd web && npm install && cd ..
```

### 2. Set up Convex

```bash
npx convex dev
```

This creates a Convex project, generates `convex/_generated/`, and starts the development server. The generated directory is intentionally not committed.

### 3. Set up Clerk

1. Create a Clerk application at [clerk.com](https://clerk.com).
2. Note the publishable key and JWT issuer domain.
3. Configure Clerk as a Convex auth provider using the [Convex + Clerk docs](https://docs.convex.dev/auth/clerk).

### 4. Configure environment variables

```bash
cp .env.example .env.local
cp web/.env.example web/.env.local
```

Then set the required Convex backend env var:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-instance.clerk.accounts.dev
```

Fill `web/.env.local` with `VITE_CONVEX_URL` and `VITE_CLERK_PUBLISHABLE_KEY`. Optional integrations use the remaining env vars documented in `.env.example` and `web/.env.example`.

### 5. Run the web app

```bash
npx convex dev
```

In another terminal:

```bash
cd web
npm run dev
```

Open `http://localhost:5173`, sign in with Clerk, connect OpenRouter, and start chatting.

## Optional Capabilities

| Capability | Required setup |
|------------|----------------|
| Core chat, personas, model picker | Convex, Clerk, OpenRouter user connection |
| Memory and generated artifacts | Core setup; benchmark enrichment is optional |
| Google Drive/Calendar | Google OAuth client, reduced scopes, and optional Picker credentials |
| Microsoft 365 | Microsoft OAuth app |
| Notion | Notion OAuth app |
| Slack tools | Slack OAuth app |
| Cloze tools | User-provided Cloze API key |
| Payments / Pro gates | Stripe env vars |
| Heavy runtime tools | Vercel Sandbox env vars |
| Web push | VAPID keys |
| Backend analytics | PostHog project token and optional analytics ID secret |

## Project Layout

```text
nanthai-edge-oss/
├── convex/                    # Convex backend
│   ├── schema.ts              # Schema entry; imports schema_tables_*.ts
│   ├── chat/                  # Chat lifecycle, streaming, audio, retry, branching
│   ├── documents/             # Canonical documents, versions, extraction, tracked changes
│   ├── tools/                 # Progressive AI tool registry and implementations
│   ├── runtime/               # just-bash, Pyodide, Vercel Sandbox services
│   ├── skills/                # Built-in skill catalog and user skill APIs
│   ├── stripe/                # Optional Stripe Checkout and webhook handling
│   └── tests/                 # Backend test suite
├── web/                       # React + Vite + TypeScript app
│   ├── src/                   # App source, routes, components, hooks, tests
│   └── public/                # Static public assets included in the OSS sync
├── docs/                      # Public architecture and implementation docs
├── .env.example               # Convex/backend env reference
├── web/.env.example           # Vite/frontend env reference
├── LICENSE                    # Source-available license
├── COMMERCIAL_LICENSE.md      # Commercial licensing info
└── CONTRIBUTING.md            # Contribution guidelines
```

## Architecture

```text
┌──────────────────────────────────────────────┐
│          Web Client (React + Vite)           │
│ React Router, Tailwind, Clerk, Convex React  │
├──────────────────────────────────────────────┤
│              Clerk Identity Auth             │
├──────────────────────────────────────────────┤
│            Convex React Client               │
│   WebSocket subscriptions, mutations, actions │
├──────────────────────────────────────────────┤
│            Convex Backend                    │
│ Schema, mutations, actions, queries, crons   │
│ StreamWriter, OpenRouter, memory, tools      │
├──────────────────────────────────────────────┤
│         OpenRouter per-user key              │
└──────────────────────────────────────────────┘
```

- **Data:** Convex is the product API and source of truth.
- **Streaming:** Convex actions call OpenRouter and patch streaming state for reactive clients.
- **Tools:** Tool families are progressively registered from skills and connected integrations.
- **BYOK:** Users connect OpenRouter via PKCE; no server-wide OpenRouter key is required.
- **Entitlements:** Optional Stripe payments sync into Convex `purchaseEntitlements`.

## Environment Variables Reference

### Root `.env.local` for Convex CLI

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `CONVEX_DEPLOYMENT` | Yes | Convex deployment name |
| `CONVEX_URL` | Yes | Convex deployment URL |
| `CONVEX_SITE_URL` | Yes | Convex HTTP endpoint URL |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Clerk JWT issuer |

### `web/.env.local` for Vite

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `VITE_CONVEX_URL` | Yes | Convex deployment URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` | No | Web push notifications |
| `VITE_POSTHOG_KEY` | No | Browser analytics token |
| `VITE_POSTHOG_HOST` | No | Browser analytics host |
| `VITE_APP_VERSION` | No | Web telemetry app version |
| `VITE_BUILD_NUMBER` | No | Web telemetry build number |
| `VITE_GOOGLE_CLIENT_ID` | No | Google OAuth |
| `VITE_GOOGLE_PICKER_API_KEY` | No | Google Drive Picker |
| `VITE_GOOGLE_PICKER_APP_ID` | No | Google Drive Picker app/project number |
| `VITE_MICROSOFT_CLIENT_ID` | No | Microsoft OAuth |
| `VITE_NOTION_CLIENT_ID` | No | Notion OAuth |
| `VITE_SLACK_CLIENT_ID` | No | Slack OAuth |

### Convex backend env vars

Set with `npx convex env set KEY VALUE`.

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Auth token validation |
| `ARTIFICIAL_ANALYSIS_API_KEY` | No | Model benchmark enrichment |
| `CONVEX_SECRET_ENCRYPTION_KEY` | No | Encrypt stored app passwords/API keys |
| `ANALYTICS_ID_SECRET` | No | Stable privacy-preserving analytics IDs |
| `POSTHOG_PROJECT_TOKEN` | No | Backend analytics capture |
| `POSTHOG_PROJECT_API_KEY` | No | Backend analytics fallback key |
| `POSTHOG_HOST` | No | Backend analytics host |
| `STRIPE_SECRET_KEY` | No* | Payment processing |
| `STRIPE_PRICE_ID` | No* | Pro tier product |
| `STRIPE_WEBHOOK_SECRET` | No* | Stripe webhook verification |
| `WEB_APP_URL` | No* | Stripe redirect base URL |
| `GOOGLE_CLIENT_ID` | No | Native Google OAuth |
| `GOOGLE_WEB_CLIENT_ID` | No | Web Google OAuth |
| `GOOGLE_WEB_CLIENT_SECRET` | No | Google OAuth secret |
| `MICROSOFT_CLIENT_ID` | No | Microsoft OAuth |
| `MICROSOFT_CLIENT_SECRET` | No | Microsoft OAuth secret |
| `NOTION_CLIENT_ID` | No | Notion OAuth |
| `NOTION_CLIENT_SECRET` | No | Notion OAuth secret |
| `SLACK_CLIENT_ID` | No | Slack OAuth |
| `SLACK_CLIENT_SECRET` | No | Slack OAuth secret |
| `VERCEL_SANDBOX_TOKEN` | No | Vercel Sandbox runtime |
| `VERCEL_SANDBOX_PROJECT_ID` | No | Vercel Sandbox runtime |
| `VERCEL_SANDBOX_TEAM_ID` | No | Vercel Sandbox runtime |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | No | Web push notifications |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | No | Web push notifications |
| `WEB_PUSH_VAPID_SUBJECT` | No | Web push sender identity |
| `APNS_KEY_ID` | No | APNs push delivery |
| `APNS_TEAM_ID` | No | APNs push delivery |
| `APNS_PRIVATE_KEY` | No | APNs push delivery |
| `APNS_BUNDLE_ID` | No | APNs push delivery |
| `APNS_ENVIRONMENT` | No | APNs environment, defaults to sandbox |
| `FCM_PROJECT_ID` | No | FCM push delivery |
| `FCM_CLIENT_EMAIL` | No | FCM push delivery |
| `FCM_PRIVATE_KEY` | No | FCM push delivery |

\* All Stripe vars plus `WEB_APP_URL` are required together if you enable Pro tier payments.

## Running Checks

```bash
npm run convex:test
npm run convex:typecheck
npm run convex:lint
npm run lint
```

```bash
cd web
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

## Contributing

Useful contributions are welcome: docs fixes, setup improvements, tests, Convex backend hardening, web UI polish, and provider integration fixes. See [CONTRIBUTING.md](CONTRIBUTING.md).

Contributions use an inbound=outbound model. By submitting a PR you grant the author rights to include your work in commercial versions.

## License

NanthAI Edge is **source-available** software.

- **Personal use, self-hosting, evaluation, learning** - free under [LICENSE](LICENSE).
- **Commercial use** - requires a paid [Commercial License](COMMERCIAL_LICENSE.md).

See [LICENSE](LICENSE) for full terms or visit [nanthai.tech/licensing](https://nanthai.tech/licensing).

**Contact:** [support@nanthai.tech](mailto:support@nanthai.tech)
