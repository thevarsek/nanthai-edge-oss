# Product Analytics

This document tracks the PostHog product analytics taxonomy used to understand activation, retention, feature usage, user pain points, and latency across web, iOS, Android, and Convex.

## Principles

- Do not capture prompt text, assistant output, uploaded file contents, transcripts, API keys, OAuth tokens, or provider payloads.
- Use the same event names across web, iOS, Android, and backend when the behavior is shared.
- Always include `platform` and `surface` so dashboards can break down web, iOS, Android, and backend/server events.
- Prefer semantic product events over raw click streams. Autocapture and session replay can help debug UX, but product growth dashboards should rely on intentional events.
- Pass client metadata into shared Convex mutations so backend events can be correlated with the client surface that initiated the work.

## Configuration

Backend analytics require Convex environment variables:

- `POSTHOG_PROJECT_TOKEN` or `POSTHOG_PROJECT_API_KEY`: PostHog project token used by backend capture.
- `POSTHOG_HOST`: optional PostHog host override; defaults to the EU ingest host.
- `ANALYTICS_ID_SECRET`: secret used to derive stable PostHog distinct IDs from Clerk user IDs without sending Clerk IDs to PostHog.

## Current Event Taxonomy

| Event | Purpose |
| --- | --- |
| `app_opened` | App/session entry across clients. |
| `app_ready` | Startup/auth/bootstrap completed enough for product use. |
| `page_viewed` | Web route view. |
| `screen_viewed` | Native route/screen view. |
| `sign_in_started` | User starts auth. |
| `sign_in_completed` | Authenticated user is identified. |
| `sign_out` | User signs out and analytics identity is reset. |
| `onboarding_started` | User enters onboarding. |
| `onboarding_step_viewed` | User sees a specific onboarding carousel step. |
| `onboarding_completed` | User completes onboarding. |
| `openrouter_connect_started` | User starts OpenRouter key connection. |
| `openrouter_connect_completed` | OpenRouter key connection succeeds. |
| `openrouter_connect_failed` | OpenRouter key connection fails. |
| `openrouter_disconnected` | User disconnects OpenRouter. |
| `chat_created` | Chat is created, including duplicate/favorite paths. |
| `chat_opened` | Chat detail opens. |
| `chat_subscription_ready` | Chat detail receives its first subscription emission with latency. |
| `message_send_attempted` | User attempts to send a chat message. |
| `message_sent` | Client-side mutation succeeds. |
| `message_send_failed` | Validation, upload, or mutation failure blocks send. |
| `message_retry_requested` | User retries/regenerates a response. |
| `message_retry_failed` | Retry mutation fails. |
| `response_copied` | User copies an assistant response or generated media URL list. |
| `response_deleted` | User deletes a response/message. |
| `branch_created` | User forks a chat branch from an existing message. |
| `message_continued` | Backend generation hands off to a continuation instead of completing in the current action. |
| `artifact_opened` | User opens a generated file/artifact preview. |
| `artifact_downloaded` | User downloads a generated file/artifact. |
| `setting_changed` | User changes a product preference; stores setting key, area, and value type only. |
| `generation_cancelled` | User interrupts active generation. |
| `assistant_first_token` | iOS first visible token latency. |
| `stream_completed` | iOS stream cadence and completion latency. |
| `assistant_response_started` | Backend generation starts. |
| `assistant_response_completed` | Backend generation completes. |
| `assistant_response_failed` | Backend generation fails with stable `failure_category`. |
| `video_generation_requested` | Backend video generation path starts. |
| `feature_used` | Semantic feature usage across clients; emitted for navigation into major feature surfaces and chat send feature flags. |

## Implemented Coverage

- Web: PostHog initialization, identify/reset, route views, app open, onboarding/OpenRouter events, chat create/open, send attempt/success/failure, retry/cancel client metadata, error boundary exception capture, feature navigation/send signals, response copy/regenerate/delete, branch create/switch, generated artifact open/download, audio play/request, chat-default setting changes, and session replay with text masked by default.
- Convex: backend PostHog helper and client metadata propagation through chat send/retry/generation paths, including assistant response success/failure, continuation handoff, video generation request events, sanitized OpenRouter usage/cost aggregates, stable failure categories, and latency breakdowns.
- iOS: PostHog SDK initialization, identify/reset, lifecycle/auth/onboarding/OpenRouter events, chat create/open, send/retry/cancel, stream latency/cadence events, branch create/switch, response regeneration, and `feature_used` for major navigation surfaces plus send-time feature flags.
- Android: PostHog SDK initialization, identify/reset, lifecycle/auth/navigation/onboarding/OpenRouter events, chat create/open/subscription-ready, send/retry/cancel, branch create/switch, response regeneration, Convex client metadata propagation, and `feature_used` for major navigation surfaces plus send-time feature flags.

## Backend Completion Fields

`assistant_response_completed` includes only sanitized aggregate fields:

- Identity/scope: `chat_id`, `message_id`, `job_id`, `model_id`, `source`, `openrouter_generation_id`.
- Client metadata: `client_platform`, `client_surface`, `client_route_or_screen`, `client_event_id`, `client_sent_at`, `client_app_version`, `client_build_number`, plus dashboard aliases `app_version` and `build_number`.
- Usage/cost: `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`, `upstream_cost_usd`, `upstream_prompt_cost_usd`, `upstream_completion_cost_usd`, `is_byok`, `cached_tokens`, `cache_write_tokens`, `reasoning_tokens`, `audio_prompt_tokens`, `audio_completion_tokens`, `image_tokens`, `video_tokens`, `web_search_requests`, `cache_discount_usd`.
- Latency/tooling: `duration_ms`, `participant_preflight_duration_ms`, `system_prompt_duration_ms`, `memory_lookup_duration_ms`, `context_assembly_duration_ms`, `provider_constraints_duration_ms`, `openrouter_round_trip_duration_ms`, `tool_execution_duration_ms`, `ttft_ms`, `first_reasoning_token_ms`, `tool_round_count`, `tool_call_count`, `compaction_count`.

## Backend Failure Fields

`assistant_response_failed` includes only sanitized failure fields:

- Scope: `chat_id`, `message_id`, `job_id`, `model_id`.
- Client metadata: same client fields and app/build aliases as completion events.
- Failure taxonomy: `failure_category` with one of `missing_api_key`, `invalid_api_key`, `insufficient_credits`, `model_unavailable`, `rate_limited`, `context_length_exceeded`, `timeout`, `cancelled`, `provider_error`, or `unknown_error`.
- Debug context: coarse `error_type` and `error_label` only. Raw provider/user-facing error text is intentionally not sent to analytics.

## Remaining High-Value Additions

Add these after the first dashboards show baseline traffic:

- Integrations: connect started/completed/failed/disconnected per provider, import started/completed/failed, provider auth failure, and protected-provider tool usage.
- Knowledge Base: file upload started/completed/failed, Drive import started/completed/failed, folder created, and oversized/unsupported-file failures.
- Personas and favorites: persona created/edited/deleted/selected, favorite created/used/edited/deleted, participant added/removed, multi-model chat used.
- Search and research: search mode selected, research paper started/completed/failed, complexity selected, citations/documents produced, and user cancellation.
- Ideascape and branching: Ideascape opened, node selected, node position saved, and graph mode send attempted.
- Subagents and autonomous mode: subagent batch started/completed/failed, autonomous session started/stopped/intervened, cycle count, and consensus stop.
- Skills and runtime tools: skill created/edited/enabled/disabled, tool profile activated, runtime execution started/completed/failed, artifact exported/downloaded.
- Documents/charts/media: document edit accepted/rejected, chart opened, video job completed/failed, and native generated-file open/download parity.
- Billing and growth: paywall viewed, Pro purchase started/completed/failed/restored, low-balance banner viewed, credit top-up intent, referral/source attribution if added.
- Reliability: Convex reconnect started/succeeded/failed, auth-token retry exhausted, subscription first-emission latency per major screen, upload latency, send upload failure stage, and user-visible error banners.

## Dashboard Starting Points

- Activation funnel: `app_opened` -> `sign_in_completed` -> `openrouter_connect_completed` -> `chat_created` -> `message_sent`.
- Platform feature usage: count events by `platform`, `surface`, `feature_area`, `search_mode`, `has_attachments`, `has_image_attachment`, `has_audio`, `has_video_config`, and `subagents_enabled`.
- Retention/stickiness: users returning to `app_opened`, `chat_opened`, or `message_sent` by day/week.
- Pain points: `message_send_failed`, `message_retry_failed`, `assistant_response_failed`, `$exception`, rage/dead clicks, and Convex reconnect failures.
- Latency: startup `app_ready`, chat `subscription_ready_ms`, backend generation duration and breakdowns, iOS `ttft_ms`, and stream cadence.
