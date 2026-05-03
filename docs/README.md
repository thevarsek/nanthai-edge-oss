# NanthAI Edge — OSS Docs

> The map for understanding, running, and extending the source-available web client and Convex backend.

## Start Here

| Goal | Read |
|------|------|
| Run the app locally | [`../README.md`](../README.md) |
| Understand the repo layout | [`project-structure.md`](project-structure.md) |
| Change backend behavior safely | [`client-convex-contract.md`](client-convex-contract.md), [`data-model.md`](data-model.md), [`testing-strategy.md`](testing-strategy.md) |
| Add tools, skills, or integrations | [`architecture.md`](architecture.md), [`service-layer.md`](service-layer.md), [`tool-skill-access.md`](tool-skill-access.md) |
| Understand chat UX and product concepts | [`design-philosophy.md`](design-philosophy.md), [`user-flows.md`](user-flows.md), [`ideascapes.md`](ideascapes.md) |
| Debug model/search behavior | [`openrouter-api.md`](openrouter-api.md), [`ttft-web-search-finding.md`](ttft-web-search-finding.md) |

## Documents

| Document | Description |
|----------|-------------|
| [`architecture.md`](architecture.md) | Backend-first product architecture, Convex data flow, streaming, tools, integrations, runtime, and feature contracts |
| [`client-convex-contract.md`](client-convex-contract.md) | Shared Convex API principles for thin clients, ownership, payload compatibility, and error contracts |
| [`data-model.md`](data-model.md) | Convex schema tables, indexes, identity scoping, generated artifacts, runtime state, memory, and retry contracts |
| [`design-philosophy.md`](design-philosophy.md) | Product vision, conversation UX principles, ideascapes, personas, memory, and non-goals |
| [`google-reduced-scopes-launch.md`](google-reduced-scopes-launch.md) | Google integration launch scope, OAuth constraints, Picker/Drive behavior, and verification notes |
| [`ideascapes.md`](ideascapes.md) | Branching architecture, spatial canvas model, node positioning, branch resolution, and rendering contract |
| [`openrouter-api.md`](openrouter-api.md) | OpenRouter OAuth PKCE, model/catalog endpoints, chat completion shape, streaming format, and headers |
| [`project-structure.md`](project-structure.md) | OSS repository layout for `convex/`, `web/`, docs, configuration, and generated files |
| [`service-layer.md`](service-layer.md) | Service boundaries between web UI, Convex functions, tools, integrations, generated artifacts, and errors |
| [`subagents.md`](subagents.md) | Delegated child-run architecture, parent continuation, lifecycle, persistence, and UI status model |
| [`tech-stack.md`](tech-stack.md) | Versions and dependency policy for the OSS web client, Convex backend, tools, and integrations |
| [`testing-strategy.md`](testing-strategy.md) | OSS test pyramid, commands, and coverage ownership for Convex and web surfaces |
| [`tool-skill-access.md`](tool-skill-access.md) | Product-facing access matrix for tools, skills, connected apps, runtime capability, and commercial gates |
| [`ttft-web-search-finding.md`](ttft-web-search-finding.md) | Web-search first-token latency investigation and OpenRouter server-tool routing notes |
| [`user-flows.md`](user-flows.md) | Product workflows for onboarding, chat, tools, personas, memory, integrations, jobs, documents, and errors |

## OSS Notes

- This repository ships the React/Vite web client and Convex backend.
- Native iOS/Android apps, milestone plans, internal risk logs, launch plans, and private marketing materials are not part of this OSS checkout.
- Some deep architecture docs mention native clients where the Convex contract is shared with the commercial sibling. Treat those references as compatibility context, not files expected to exist in this repository.

## Why These Docs Matter

NanthAI Edge is intentionally more complete than a starter template. The docs are here to make the implementation approachable: where state lives, which contracts are public, how streaming is persisted, how tools run, and which optional services unlock which features.
