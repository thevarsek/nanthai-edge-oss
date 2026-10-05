# Testing Strategy

NanthAI Edge OSS uses Convex as the product API and a React/Vite web client as the shipped UI. Tests should protect shared backend behavior first, then cover web rendering and route behavior with seeded data.

## Test Pyramid

| Layer | Purpose | Command |
| --- | --- | --- |
| Convex unit/contract | Shared product rules, payloads, helper behavior, and error contracts | `npm run convex:test` |
| Convex typecheck | Backend function and schema type safety | `npm run convex:typecheck` |
| Convex lint | Backend lint gate | `npm run convex:lint` |
| Web unit/component | Fast helper and React surface coverage with seeded data | `cd web && npm run test` |
| Web E2E smoke | Browser canary for public shell, auth redirects, and key routes | `cd web && npm run test:e2e` |
| Web typecheck | Vite app TypeScript gate | `cd web && npx tsc --noEmit --project tsconfig.app.json` |
| Web lint | Frontend lint gate | `cd web && npm run lint` |

## Root Commands

```bash
npm run convex:test
npm run convex:typecheck
npm run lint

cd web
npm run test
npm run test:e2e
npm run lint
npx tsc --noEmit --project tsconfig.app.json
```

## Coverage Defaults

- Convex tests own shared product contracts: chat lifecycle, retry payloads, tools, search state, memory, generated documents, model metadata, and structured errors.
- Web tests should not require a live Clerk user. Authenticated route and component tests should use mocked Convex/Clerk data unless a dedicated test-account flow is intentionally added.
- Browser smoke tests should verify that the public shell, auth redirects, OpenRouter callback flow, and representative app routes render without runtime failures.
- Generated-document payloads should be decoded permissively. Only events with `storageId`, `filename`, and `mimeType` should be treated as generated-file attachment suggestions.
- Convex wire values that are conceptually integer-like may arrive as numbers with floating-point shape. Client helpers should avoid brittle integer-only decoding assumptions.

## Journey Ownership

| Journey | Convex | Web |
| --- | --- | --- |
| Authenticated shell loads | Auth/session contracts and current-user resolution | Route smoke tests with mocked app shell |
| Chat list search/filter/pin surfaces | Shared ordering, folder flags, favorites, and archive state | Component/route tests with seeded chats |
| Chat detail pending/streaming/final/error | Message status, streaming state, retry contract, terminal errors | Component/route tests with seeded states |
| Generated document cards | Generated-file query and document event payloads | Card rendering tests and attachment guard tests |
| Knowledge Base list/picker | KB queries, file metadata, and document import state | Component or route tests with seeded files |
| Model/persona/default selection | Preference/default resolution and model capability gates | Helper/component tests for picker and overrides |
| Error extraction and retry state | Structured `ConvexError` payloads | Helper tests for displayed error messages |
