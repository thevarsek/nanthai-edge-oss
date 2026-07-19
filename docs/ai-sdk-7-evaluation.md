# AI SDK 7 Evaluation

Decision date: 2026-07-19. Decision: retain the existing OpenRouter executor under Convex Workflow; do not adopt `WorkflowAgent` for the production control plane in M47.

## Baseline finding

The repository declared AI SDK 6 (`ai`, `@ai-sdk/openai`, and `@ai-sdk/provider-utils`) and mounted `@convex-dev/agent`, but production code did not import them. They were dependency and component surface without application value. M47 removes those packages and the unused Agent component, then adds only `@convex-dev/workflow` and `@convex-dev/workpool` to production.

## Measured AI SDK 7 spike

The reproducible spike lives in `spikes/ai-sdk-7`; its dependencies are isolated from the production backend. It pins `ai@7.0.31`, `@ai-sdk/workflow@1.0.31`, and `@ai-sdk/openai-compatible@3.0.12`.

Measured on 2026-07-19:

- clean install: 25 packages, 56 MB installed development tree, zero reported vulnerabilities;
- WorkflowAgent distribution: 91,018 bytes uncompressed / 16,576 bytes gzip;
- strict TypeScript: passed;
- two executable parity contracts: passed in 201 ms total;
- mocked WorkflowAgent streaming carried the execution-run/fence runtime context through one model step and produced the expected terminal result;
- mocked OpenRouter HTTP transport preserved the selected model plus `provider.zdr`, provider order, and `transforms` in the request body.

This proves that AI SDK 7 can represent a basic NanthAI-shaped OpenRouter call and carry executor context. It does not prove parity for progressive tool profiles, multi-participant branches, Convex streaming, deferred joins, artifact ownership, operation reconciliation, or the current provider recovery rules. Closing those gaps would bridge two durable planes rather than delete the Convex one.

## Options

| Criterion | Existing OpenRouter loop + Convex Workflow | AI SDK 7 `WorkflowAgent` |
|---|---|---|
| Canonical durable plane | Convex only | Convex product state plus Vercel Workflow orchestration |
| Current provider behavior | Already proven, including OpenRouter routing and provider parameters | Basic wire contract passed; full parity remains unproven |
| ZDR/protected routing | Already enforced | ZDR body propagation passed; capability/protected-routing parity remains unproven |
| Multi-participant branches | Existing production contract | Spike required |
| Progressive skills/tool profiles | Existing registry and continuation checkpoint | Adapter work required |
| Deferred presentations, Drive picker, subagents | Existing durable domain callbacks | Adapter and join mapping required |
| iOS/Android/web streaming | Existing Convex subscriptions | New stream projection required |
| Effect journal/fencing | Native M46 identity through the executor | Must bridge two lifecycle systems |
| Infrastructure/cost | Existing Convex plus per-request providers | Adds another hosted orchestration dependency |
| Rollback | Deploy the preceding application version for new attempts; the canonical execution data plane is unchanged | Cross-plane reconciliation required |
| Code removed | Workflow removes handoff scheduling while preserving tool code | Unclear until feature parity; likely adds bridging first |

## Decision

Choose Convex Workflow plus the current OpenRouter loop.

The objective was durable progression beyond ten minutes, not replacing a working model SDK for its own sake. Convex Workflow solves that directly: each completed round is a persisted step and the next round receives a new action budget. Adopting `WorkflowAgent` would introduce a second durable state plane before it demonstrated parity with NanthAI's highest-risk behavior.

No AI SDK 7 runtime dependency remains in production after this decision. The isolated spike remains for future reassessment without implying that NanthAI currently uses AI SDK 6 or 7 in production.

## WorkflowAgent reassessment gate

Reconsider only if a contained executor can demonstrate all of the following against the same fixtures:

- direct OpenRouter and provider-specific parameter parity;
- ZDR and protected routing parity;
- progressive tools, skills, compaction, and exact checkpoint parity;
- deferred child work and artifacts without duplicate lifecycle truth;
- shared Convex streaming projection on all clients;
- M46 fencing, cancellation, and operation-journal propagation;
- lower lifecycle state count and a meaningful net code deletion;
- acceptable latency, bandwidth, provider cost, hosted orchestration cost, and rollback.

Until then, `WorkflowAgent` is not a stronger fit than the implemented design: it solves durability, but in a plane that NanthAI does not otherwise need.

## HarnessAgent and M45

AI SDK 7's harness adapters are useful discovery input for runtime interoperability. Pi, Codex, Claude Code, OpenCode, and future ACP-style runtimes may inform adapter semantics. That does not make `HarnessAgent` or a Vercel VM NanthAI's shared backend.

M45 remains Pi-first because Pi can run on the user's own machine. The M46 protocol is intentionally adapter-neutral so later integrations can expand reach without changing chat, artifact, usage, or client business contracts.

## References

- [Convex workflows](https://docs.convex.dev/agents/workflows)
- [AI SDK 7 announcement](https://vercel.com/blog/ai-sdk-7)
- [AI SDK program-agent harnesses](https://vercel.com/changelog/program-agent-harnesses-with-ai-sdk)
- [WorkflowAgent guide](https://vercel.com/kb/guide/what-is-workflowagent)
