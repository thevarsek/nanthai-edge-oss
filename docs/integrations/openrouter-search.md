# OpenRouter web search

## Request contract

`convex/lib/openrouter_request.ts` uses `plugins: [{ id: "web", max_results: 5 }]`
when web search is enabled. It preserves other configured plugins and leaves the
search engine unset for OpenRouter to select. It does not add the
`openrouter:web_search` server-tool definition for this path.

The plugin form was selected after a matched request comparison found less startup
overhead for the tested non-native-search and ZDR routes. Those measurements are
historical observations, not fixed latency guarantees for current providers.
A server-tool invocation can add a model/tool round; plugin preparation supplies
search results before the model response.

## Privacy and timing

The effective provider/ZDR rules still apply. Search does not remove a required
privacy setting, silently disable itself for speed, or change the user's model.
Measure admission, search preparation, provider headers, reasoning and first visible
content separately. Provider routing and cache state can change the observed cost.

Request-shape tests live in `convex/tests/openrouter_helper_edges.test.ts`.
See [chat latency](../architecture/chat-latency.md) and
[OpenRouter API](openrouter-api.md) for related contracts. Superseded measurement
grids and rejected UI proposals remain in Git history.
