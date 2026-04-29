# NanthAI Edge — Documentation Index

> Detailed architecture and reference documentation extracted from the master plan.
> For milestone tracking, see [`milestones/`](../milestones/).

## Documents

| Document | Description |
|----------|-------------|
| [`design-philosophy.md`](design-philosophy.md) | Product vision, core features, iMessage design language, non-goals |
| [`architecture.md`](architecture.md) | Confirmed architectural decisions, layer diagram, DI container, navigation coordinator, server seam |
| [`tech-stack.md`](tech-stack.md) | Technology table, deployment target policy, zero-dependency rationale |
| [`data-model.md`](data-model.md) | Convex schema — 46 app tables (4 schema files), runtime/capability tables, DTO types, indexes, identity scoping |
| [`service-layer.md`](service-layer.md) | Service protocols, ConvexService, SharedAppDataStore, capability subscriptions, generated-chart UI seams, OAuth VMs, tool auth helpers, error types |
| [`project-structure.md`](project-structure.md) | Complete directory tree for Xcode project, tests, and utilities |
| [`max-runtime-analytics.md`](max-runtime-analytics.md) | Max runtime architecture — capabilities, three-tier execution (just-bash, Pyodide, Vercel Sandbox), workspace/analytics tools, generated charts, iOS/Android status |
| [`tool-skill-access.md`](tool-skill-access.md) | Product-facing access matrix for tiers, tools, skills, connected apps, and internal Max/runtime capability |
| [`subagents.md`](subagents.md) | Depth-1 delegated child runs — gating, lifecycle, async parent resume, child continuation |
| [`openrouter-api.md`](openrouter-api.md) | OpenRouter API endpoints, OAuth PKCE flow, chat completion request/response, SSE stream format, required headers |
| [`risks.md`](risks.md) | Risk log with severity ratings and mitigations, Apple API validation notes |
| [`reference-app.md`](reference-app.md) | Analysis of the existing web app (chatology-nanthai) — stack, DB schema, patterns to preserve, pain points, file map |
| [`future-notes.md`](future-notes.md) | Pre-launch review & technical debt notes (M1–M13); future enhancements |
| [`ideascapes.md`](ideascapes.md) | Branching architecture & ideascape spatial canvas — branch path resolution, auto-layout, canvas architecture, divergence indicators |
| [`monetization.md`](monetization.md) | Free vs Pro feature tiers, pricing rationale, gating implementation, paywall content reference |
| [`mobile-api-contract.md`](mobile-api-contract.md) | Public Convex function surface — queries, mutations, actions consumed by iOS and Android clients |
| [`google-reduced-scopes-launch.md`](google-reduced-scopes-launch.md) | M24 Google reduced-scope launch status — final OAuth scopes, launch gate, demo flow, and invariants |
| [`android-architecture-notes.md`](android-architecture-notes.md) | Android app architecture — package layout, Jetpack Compose UI, Clerk/Convex integration, navigation |
| [`android-release-guide.md`](android-release-guide.md) | Android release checklist — versioning, signing, Play Console workflow, pre-launch report |

## How to Use

- **Before making structural changes**, read the relevant doc(s) above plus [`plan.md`](../plan.md) (the hub document).
- **For implementation work**, check the relevant [`milestones/M*.md`](../milestones/) file for task-level detail.
- **For code style and conventions**, see [`AGENTS.md`](../AGENTS.md).

---

*These docs are the authoritative source for confirmed architecture. `plan.md` serves as a lean index pointing here.*
