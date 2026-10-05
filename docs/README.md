# NanthAI Edge — OSS Docs

> The map for understanding, running, and extending the source-available web client and Convex backend.

## Start Here

| Goal | Read |
|------|------|
| Run the app locally | [Readme](../README.md) |
| Understand the repo layout | [Project structure](development/project-structure.md) |
| Change backend behavior safely | [Client convex contract](architecture/client-convex-contract.md), [Data model](architecture/data-model.md), [Testing strategy](development/testing-strategy.md) |
| Add tools, skills, or integrations | [Architecture](architecture/architecture.md), [Service layer](clients/service-layer.md), [Tool skill access](product/tool-skill-access.md) |
| Understand chat UX and product concepts | [Design philosophy](product/design-philosophy.md), [User flows](product/user-flows.md), [Ideascapes](product/ideascapes.md) |
| Debug model/search behavior | [Openrouter api](integrations/openrouter-api.md), [Openrouter search](integrations/openrouter-search.md) |

## Documents

| Document | Description |
|----------|-------------|
| [Architecture](architecture/architecture.md) | Backend-first product architecture, Convex data flow, streaming, tools, integrations, runtime, and feature contracts |
| [Client convex contract](architecture/client-convex-contract.md) | Shared Convex API principles for thin clients, ownership, payload compatibility, and error contracts |
| [Data model](architecture/data-model.md) | Convex schema tables, indexes, identity scoping, generated artifacts, runtime state, memory, and retry contracts |
| [Design philosophy](product/design-philosophy.md) | Product vision, conversation UX principles, ideascapes, personas, memory, and non-goals |
| [Google reduced scopes launch](integrations/google-reduced-scopes-launch.md) | Google integration launch scope, OAuth constraints, Picker/Drive behavior, and verification notes |
| [Ideascapes](product/ideascapes.md) | Branching architecture, spatial canvas model, node positioning, branch resolution, and rendering contract |
| [Openrouter api](integrations/openrouter-api.md) | OpenRouter OAuth PKCE, model/catalog endpoints, chat completion shape, streaming format, and headers |
| [Project structure](development/project-structure.md) | OSS repository layout for `convex/`, `web/`, docs, configuration, and generated files |
| [Service layer](clients/service-layer.md) | Service boundaries between web UI, Convex functions, tools, integrations, generated artifacts, and errors |
| [Subagents](architecture/subagents.md) | Delegated child-run architecture, parent continuation, lifecycle, persistence, and UI status model |
| [Tech stack](development/tech-stack.md) | Versions and dependency policy for the OSS web client, Convex backend, tools, and integrations |
| [Testing strategy](development/testing-strategy.md) | OSS test pyramid, commands, and coverage ownership for Convex and web surfaces |
| [Tool skill access](product/tool-skill-access.md) | Product-facing access matrix for tools, skills, connected apps, runtime capability, and commercial gates |
| [Openrouter search](integrations/openrouter-search.md) | Web-search first-token latency investigation and OpenRouter server-tool routing notes |
| [User flows](product/user-flows.md) | Product workflows for onboarding, chat, tools, personas, memory, integrations, jobs, documents, and errors |

## OSS Notes

- This repository ships the React/Vite web client and Convex backend.
- Native iOS/Android apps, milestone plans, internal risk logs, launch plans, and private marketing materials are not part of this OSS checkout.
- Some deep architecture docs mention native clients where the Convex contract is shared with the commercial sibling. Treat those references as compatibility context, not files expected to exist in this repository.

## Why These Docs Matter

NanthAI Edge is intentionally more complete than a starter template. The docs are here to make the implementation approachable: where state lives, which contracts are public, how streaming is persisted, how tools run, and which optional services unlock which features.
