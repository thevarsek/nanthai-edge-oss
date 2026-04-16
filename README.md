# NanthAI:Edge

> **Source-available AI chat platform** — web client (React/Vite) + real-time backend (Convex) + Clerk auth. Users bring their own OpenRouter API key and chat with 300+ AI models.

[![License: Source-Available](https://img.shields.io/badge/License-Source--Available-blue)](/LICENSE)

---

## What is NanthAI Edge?

[NanthAI:Edge](https://nanthai.tech) is a full-featured AI chat application with multi-model conversations, personas, memory, scheduled jobs, internet search, integrations, and more — all powered by a [Convex](https://convex.dev) real-time backend.

This repository contains the **web client** and **Convex backend**. It's everything you need to self-host your own instance.

### Key Features

- **Multi-model chat** — Send to 2–3 models simultaneously, compare side-by-side
- **Personas** — Custom AI alter-egos with model assignment, system prompts, parameter overrides
- **AI Skills** — Progressive disclosure skill system with catalog and per-chat bindings
- **Internet Search** — 3 tiers (Basic, Web Search, Research Paper) with complexity settings
- **Memory** — Vector-based memory with 10 categories, extraction modes, persona scoping
- **Audio Messages** — Voice recording, TTS playback, auto-audio mode
- **Scheduled Jobs** — Recurring AI tasks with multi-step pipelines
- **Integrations** — Google Workspace, Microsoft 365, Notion
- **BYOK** — Every user brings their own OpenRouter API key via PKCE OAuth. No server-side AI key needed.

## Self-Hosting Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- A free [Convex](https://convex.dev) account
- A free [Clerk](https://clerk.com) account
- An [OpenRouter](https://openrouter.ai) account (each user provisions their own key)

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

This creates a new Convex project, generates the `convex/_generated/` type stubs, and starts the development server. The `_generated/` directory is not included in this repo — it is created automatically on first run. Note your deployment URL.

### 3. Set up Clerk

1. Create a Clerk application at [clerk.com](https://clerk.com)
2. Note your **Publishable Key** and **JWT Issuer Domain**
3. Configure Clerk as a Convex auth provider — see [Convex + Clerk docs](https://docs.convex.dev/auth/clerk)

### 4. Configure environment variables

Copy the example files and fill in your values:

```bash
# Root — Convex CLI config
cp .env.example .env.local

# Web — Vite frontend config
cp web/.env.example web/.env.local
```

Then set the required Convex backend env vars:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-instance.clerk.accounts.dev
```

See `.env.example` for the full list of optional env vars (Stripe, Google, Microsoft, Notion, VAPID push).

### 5. Run the dev server

```bash
# Terminal 1 — Convex backend
npx convex dev

# Terminal 2 — Web frontend
cd web && npm run dev
```

Open `http://localhost:5173` and sign in with Clerk. Connect your OpenRouter account to start chatting.

## Project Layout

```
nanthai-edge-oss/
├── convex/                    # Convex backend (TypeScript)
│   ├── schema.ts              # Database schema
│   ├── chat/                  # Chat orchestration, streaming, audio
│   ├── tools/                 # AI tools (apple, google, microsoft, notion, workspace)
│   ├── memory/                # Vector memory system
│   ├── models/                # Model catalog sync
│   ├── push/                  # Web push delivery
│   ├── tests/                 # Backend test suite
│   └── ...                    # Personas, folders, preferences, skills, etc.
├── web/                       # Web client (React + Vite + TypeScript)
│   ├── src/                   # App source
│   └── public/                # Static assets, SEO files
├── docs/                      # Architecture documentation
├── .env.example               # Backend env var reference
├── web/.env.example           # Frontend env var reference
├── LICENSE                    # Source-available license
├── COMMERCIAL_LICENSE.md      # Commercial licensing info
└── CONTRIBUTING.md            # Contribution guidelines
```

## Architecture

```
┌──────────────────────────────────────────────┐
│          Web Client (React + Vite)           │
│     React Router · Tailwind · shadcn/ui      │
├──────────────────────────────────────────────┤
│              Clerk Identity Auth              │
│          (@clerk/clerk-react)                │
├──────────────────────────────────────────────┤
│            Convex React Client               │
│   (WebSocket subscriptions, mutations, acts)  │
├──────────────────────────────────────────────┤
│            Convex Backend (Server)            │
│  Schema · Mutations · Actions · Queries · Crons│
│  StreamWriter · OpenRouter · Memory · Tools   │
├──────────────────────────────────────────────┤
│         OpenRouter (300+ AI models)           │
│       API key via PKCE, per-user              │
└──────────────────────────────────────────────┘
```

- **Auth:** Clerk manages identity. OpenRouter API key provisioned per-user via PKCE OAuth.
- **Data:** All persistence is Convex server-side. The web client subscribes to reactive queries over WebSocket.
- **Streaming:** Server-side OpenRouter calls via Convex Actions. `StreamWriter` patches message content in-place.
- **Tools:** 76 built-in AI tools execute server-side in Convex actions.
- **BYOK:** There is no server-side OpenRouter API key. Every user connects their own OpenRouter account.

## Environment Variables Reference

### Root `.env.local` (Convex CLI)

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `CONVEX_DEPLOYMENT` | Yes | Convex deployment name |
| `CONVEX_URL` | Yes | Convex deployment URL |
| `CONVEX_SITE_URL` | Yes | Convex HTTP endpoint URL |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Clerk JWT issuer |

### `web/.env.local` (Vite frontend)

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `VITE_CONVEX_URL` | Yes | Convex deployment URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` | No | Web push notifications |
| `VITE_GOOGLE_CLIENT_ID` | No | Google integration |
| `VITE_MICROSOFT_CLIENT_ID` | No | Microsoft integration |
| `VITE_NOTION_CLIENT_ID` | No | Notion integration |

### Convex Backend Env Vars (set via `npx convex env set`)

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Auth token validation |
| `ARTIFICIAL_ANALYSIS_API_KEY` | No | Model benchmark enrichment |
| `STRIPE_SECRET_KEY` | No* | Payment processing |
| `STRIPE_PRICE_ID` | No* | Pro tier product |
| `STRIPE_WEBHOOK_SECRET` | No* | Stripe webhook verification |
| `WEB_APP_URL` | No* | Web app URL (for Stripe redirects) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth |
| `GOOGLE_WEB_CLIENT_ID` | No | Google web OAuth |
| `GOOGLE_WEB_CLIENT_SECRET` | No | Google OAuth secret |
| `MICROSOFT_CLIENT_ID` | No | Microsoft OAuth |
| `MICROSOFT_CLIENT_SECRET` | No | Microsoft OAuth secret |
| `NOTION_CLIENT_ID` | No | Notion OAuth |
| `NOTION_CLIENT_SECRET` | No | Notion OAuth secret |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | No | Web push notifications |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | No | Web push notifications |
| `WEB_PUSH_VAPID_SUBJECT` | No | Web push sender identity |

\* All four Stripe/WEB_APP_URL vars are required together if you enable Pro tier payments. Without them the app works fine — Pro gating is simply disabled.

## Running Tests

```bash
# Convex backend tests
npx tsx --test convex/tests/*.test.ts

# TypeScript type checking (backend)
npx tsc --noEmit --project convex/tsconfig.json

# TypeScript type checking (web)
cd web && npx tsc --noEmit --project tsconfig.app.json
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Contributions use an inbound=outbound model — by submitting a PR you grant the author rights to include your work in commercial versions.

## License

NanthAI Edge is **source-available** software.

- **Personal use, self-hosting, evaluation, learning** — free, no license needed.
- **Commercial use** — requires a paid [Commercial License](COMMERCIAL_LICENSE.md).

See [LICENSE](LICENSE) for full terms or visit [nanthai.tech/licensing](https://nanthai.tech/licensing).

**Contact:** [support@nanthai.tech](mailto:support@nanthai.tech)
