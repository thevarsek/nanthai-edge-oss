# Chat latency and runtime boundaries

Interactive startup keeps bounded chat coordination in Convex V8. The V8 coordinator
must not import Node participant implementations. Node-required media, document,
integration or expanded-profile operations delegate through narrow Node actions
after runtime-safety preflight. Available deferred tools do not themselves activate
Node execution.

Workflow owns durability, while domain state and the execution fence own correctness.
Initial interactive dispatch and subsequent rounds must preserve those owners when
reducing scheduler overhead. Queue concurrency is not an application usage quota.

## Measurement

Distinguish request admission, context/helper work, Workflow dispatch, provider
connection, provider first token and client-visible first token. A direct provider
probe is a lower-bound comparison, not end-to-end chat latency. Cached context,
provider routing, model reasoning and tool/search rounds can materially change
measurements; report the selected route and actual response behavior.

Tool-capable web search can add a real tool round. Do not infer the number of
provider requests from the name of the search setting. The source contract is
maintained in [OpenRouter search](../integrations/openrouter-search.md).

See [workload authoring](durable-workload-authoring.md) for the current V8/Node
boundary and test requirements. Historical startup measurements belong to the
[orchestration milestone](../../milestones/M47-durable-cloud-orchestration.md).
