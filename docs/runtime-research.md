# Runtime research and adoption register

> Reviewed: 2026-09-09. Primary project documentation and selected repository surfaces, not a performance/security audit or an installation run.
> Purpose: tell implementers what to inspect, what it could replace or support, and what must be verified before adoption. Links describe current upstream work; production adapters must pin actual versions and verify their own supported matrix.

## How to use this register

The release roadmap remains authoritative. A source here does not authorize a new dependency, provider credential flow, remote service, model spend or architecture rewrite. Record source commit/package version, license/notices, required runtime, network behavior, security boundary, relevant APIs, tests and removal cost before copying or embedding code.

Prefer borrowing a narrow pattern over importing a second backend. Verify dynamic upstream claims against the selected version. Stars, screenshots and upstream benchmark percentages are not NanthAI evaluation evidence. The source set includes competing products to calibrate claims, not to imply that their features are absent from the market.

## Harness integration — M45 / M53 / M54

| Source | Useful observation / pattern | Adoption or revisit gate |
|---|---|---|
| [Codex App Server](https://developers.openai.com/codex/app-server), [auth](https://developers.openai.com/codex/auth), [source](https://github.com/openai/codex) | Programmatic agent sessions, native requests/events and supported account authentication; repository currently labels its source Apache-2.0 | Keep existing local-stdio choice; pin executable/schema and test approvals, actual native IDs, context injection and cancellation. Subscription access is not documented as a generic arbitrary-harness inference entitlement |
| [T3 Code](https://github.com/pingdotgg/t3code) | A current example of a control surface over installed harnesses, including remote/mobile interfaces; repository is labelled MIT | Study adapter/account/event and client-server compatibility boundaries. Its existence means remote control or subscription-backed orchestration alone is not a unique market claim. Verify provider-specific rights independently |
| [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [documentation index](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md) | Direct JSONL process interface and extensible context/tool/session behavior | Use an isolated worker and actual native capabilities. Inspect context hooks, steering, compaction and trust at the pinned revision; do not infer sandboxing from process separation |
| [GitHub Copilot ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server) | Public-preview interface intended for programmatic clients; some startup options govern all sessions in a server | Check supported auth/terms and session isolation. Different Persona tool/settings requirements may require separate server processes. Evaluation access does not equal production certification |
| [OpenCode server](https://opencode.ai/docs/server/), [ACP](https://opencode.ai/docs/acp/) | Alternative headless/session surfaces to evaluate if another maintained adapter is useful | Verify selected public interface and feature parity before adding it. Do not force richer native interfaces through ACP merely to standardize a transport |

Keep inference and agent integration separate. For provider-only native execution, use documented API keys, OpenRouter or a verified local/provider API. For subscription-backed native-harness execution, let the supported harness own authentication. [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt) is an identity integration; identity authorization alone is not a metered-inference credit.

The prior branch's pinned Codex/Node versions are historical tested inputs, not a claim about today's latest releases. Do not update them automatically in a documentation-only change.

## Code intelligence — M53 / M56 / M57

### Graft

Sources: [repository](https://github.com/trailhq/Graft), [project website](https://trailhq.com/graft).

The documented structural pass uses local code structure, targeted retrieval and code relationships, with optional model-enriched information. This is a candidate for reducing repeated blind search/read exploration, not a reason to eliminate exact string search.

The reviewed README includes configurable telemetry/version-check behavior and installation/configuration effects, while the website advertises no telemetry. Treat that mismatch as unresolved until the pinned package's source/configuration is reviewed. Do not promise offline/no-network operation from a landing page. Inspect whether initialization changes global Codex or repository files before invoking it. NanthAI should use an explicit controlled adapter rather than blindly calling a convenience initializer.

Tool names have changed across examples: bind the advertised schema at the selected version instead of copying names from this conversation. Require exact source locators, freshness after uncommitted edits, bounded output and ignore/private-file behavior. The repository labels its license MIT; review pinned code and dependencies before redistribution. Do not repeat its benchmark claims as NanthAI results.

### Serena

Sources: [repository](https://github.com/oraios/serena), [license](https://github.com/oraios/serena/blob/main/LICENSE).

Language-server-backed symbol navigation and editing can provide more precise operations than raw text search. It is a candidate for semantic references/refactors, not necessarily the same service as Graft's repository orientation. The license inspected is MIT.

Verify the actual language-server/toolchain support needed by TS, Swift, Kotlin and Python repositories, project initialization cost, dirty-buffer/filesystem state, rename/reference correctness and diagnostic coverage. Editing tools must respect the selected write policy. Do not install both large stacks by default without measurable complementary value.

### Lightweight repository map

Sources: [Aider repository-map documentation](https://aider.chat/docs/repomap.html), [source](https://github.com/Aider-AI/aider).

A compact symbol/reference map is a smaller orientation strategy to compare before building a full new graph. Use its design as an alternative, not an assumption that a fixed token budget works for every repository. Verify license and code selected for reuse rather than copying the whole application.

Test orientation/retrieval against fixed task queries first. Assess location accuracy, stale symbol removal, unsupported languages, query volume, indexing cost and returned tokens. M53 separates source gains from NanthAI assembly; M56 turns the selected source into bounded evidence; M57 consumes it only if the native experiment proceeds.

## Evaluation and cost — M53 / M56 / M57

| Source | Pattern to reuse | Important limit |
|---|---|---|
| [Harbor](https://github.com/harbor-framework/harbor) | Reproducible task execution/environments and grader organization | A $25 screen needs a small manifest, not a new benchmark platform |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench) | Pinned repository task and executable patch evaluation | Avoid answer/test leakage; a tiny custom sample is not a general leaderboard result |
| [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching) | Track cached/uncached input and provider-specific cache economics | Fewer submitted tokens can be outweighed by cache misses, summaries or repeated indexing |
| [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling) | Explicit model/tool execution loop and local-provider tests | A compatible endpoint or model name is not proof of complete behavior on the selected model |

Evaluate normal continued sessions and fresh handoffs separately. Ordinary harness compaction/caching is part of the baseline, not something to disable to help NanthAI. Record requested, submitted and reported context/usage separately when the native harness remains opaque. Follow [runtime-context-evaluation.md](runtime-context-evaluation.md).

## Work coordination — M55

| Source | Pattern to inspect | What not to copy blindly |
|---|---|---|
| [Bothread](https://github.com/AdamACE9/bothread) | Shared human/agent room, tasks, handoffs and path-claim coordination | Advisory claims are not enforcement; independent workers can still collide |
| [Clawe](https://github.com/getclawe/clawe) | Convex-backed agent profiles, work-state transitions, human/agent messages and notifications | Current repository is AGPL-3.0. Use as architectural research; code reuse requires a separate compatible licensing decision. Do not add its extra scheduler instead of M46/M47 |
| [LangGraph Swarm](https://github.com/langchain-ai/langgraph-swarm-py) | Explicit handoff and active-agent responsibility | A handoff library is not automatically parallel teamwork; full shared-history defaults are not NanthAI's targeted context policy |
| [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams) | Existing shared tasks, direct inter-agent communication and human steering | This is already a competitive baseline; no 'first human-visible swarm' claim |
| [Git worktree](https://git-scm.com/docs/git-worktree) | Separate working directories and result integration | Shared Git metadata and external resources remain; worktrees are not security sandboxes |

Work ownership must be structured and acceptance must cite current requirements/source/test evidence. Do not make consensus equivalent to correctness. Compare a small two-Persona team with a strong single agent; keep useful human-led work management when more autonomous turns do not improve outcomes.

## Durable backend and distribution — M45 / M54 / M56

- [Convex Workflows](https://docs.convex.dev/agents/workflows): retain current durable steps, waits and established component ownership. The repository's M46/M47/M48 contract remains the application source of truth, not an upstream tutorial's default lifecycle.
- [Convex component authoring](https://docs.convex.dev/components/authoring): possible reusable package boundary after real consumers exist. Component state/auth boundaries require deliberate integration; renaming a folder is not component extraction.
- [Convex self-hosting](https://docs.convex.dev/self-hosting): Docker self-hosting is available, with operational responsibilities. It is separate from offline branching and does not replace the managed cloud by default.
- [Node child processes](https://nodejs.org/api/child_process.html): drain bounded stdio and understand process/environment behavior. PID termination alone does not establish descendant cleanup.
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): evaluate process-group ownership, breakaway and cleanup for a later supported Windows release.
- [Apple SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice) and [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution): official references for login/distribution implementation. The browser exposed JavaScript-gated pages in this review, not a complete API walkthrough. Verify SDK docs and the actual bundle during M54; debug success is not signing/notarization evidence.
- [MCP authorization](https://modelcontextprotocol.io/docs/tutorials/security/authorization): use scoped/audience-aware authorization and separate product checks. Do not forward provider tokens indiscriminately or expose arbitrary local shell through the history interface.

## Offline persistence — M58

[SQLite atomic commit](https://sqlite.org/atomiccommit.html), [WAL](https://sqlite.org/wal.html), and [backup API](https://sqlite.org/backup.html) provide concrete recovery/backup patterns. Use transactions for related state and a crash-consistent artifact protocol. SQLite's guarantees do not make arbitrary external tool effects transactional. Test the chosen binding/filesystem, backup behavior and full-disk failures.

The [Pi documentation index](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md) links maintained Sessions and Session format references. The older singular `session.md` link returned 404 during this review; use the index's current `sessions.md`/`session-format.md` references and verify at the pin. Its format is inspiration, not authority over NanthAI online state.

Offline operation needs explicit authority and reconciliation. An imported transcript must not be executed again. Missing source validation remains missing; cached Persona settings do not overwrite current cloud Persona configuration after reconnect.

## Adoption checklist and next decisions

Before implementation selects a referenced library or pattern, record the specific requirement, existing owner it extends, pinned version/commit, license/dependency obligations, process/data boundary, network/telemetry/configuration side effects, capability tests, fallback/error behavior and removal trigger.

Revisit authentication and provider limits at release; source tools when target languages or freshness behavior change; context investment after measured results; team policies after real task outcomes; native execution only for a named user benefit; offline storage when there is demonstrated need. No unmeasured performance claim or dependency adoption is implied by this register.
