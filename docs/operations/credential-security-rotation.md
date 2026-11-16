# Credential encryption and rotation runbook

This milestone encrypts OAuth credentials and OpenRouter keys with AES-256-GCM
and contextual authenticated data. It protects against database-only disclosure;
it does not protect credentials if both the Convex runtime and its environment
keys are compromised.

## Current deployed state

The format migration and k2 rotation completed in development and production on
2026-07-31. Production was rotated again to `k3` on 2026-11-16.

- Production: `k3` is the active writer. All credential rows are `enc:v2`/`k3`
  (11 OAuth connections, 103 user secrets, no MCP credentials at rotation time).
  `k1` and `k2` key material has been removed from the production runtime, so
  backups taken before 2026-11-16 restore with unreadable credential rows and
  affected users reconnect.
- Development: `k2` is the active writer with its own key material.
- Legacy plaintext and `enc:v1` reads are disabled.
- Automatic rotation is disabled until an operator deliberately starts another
  documented rotation.
- The raw video-upload-token compatibility fields, indexes, migration and cron
  have been removed. Video jobs also no longer persist polling URLs; provider
  endpoints are constructed locally from the stable provider job ID.

The backend deployment is live. Updated clients use the server-side OpenRouter
exchange, while `scheduledJobs/mutations:upsertApiKey` remains as an encrypted
compatibility path for released clients.

## Environment contract

| Variable | Purpose |
|---|---|
| `CONVEX_SECRET_ENCRYPTION_KEY` | Legacy `k1` material. Removed from production; retained in development only for older development backups. |
| `CONVEX_SECRET_ENCRYPTION_KEY_K3` | Production active key material. |
| `CONVEX_SECRET_ENCRYPTION_KEY_K2` | Development active key material; removed from production. |
| `CONVEX_SECRET_ENCRYPTION_ACTIVE_KID` | Active writer key ID; currently `k3` in production and `k2` in development. |
| `CONVEX_SECRET_LEGACY_READ_MODE` | Currently `disabled`; `migrate` is used only during an approved migration or older-backup restore. |
| `CONVEX_SECRET_ROTATION_MODE` | Currently `disabled`; operators may temporarily select `dry_run` or `rotate`. |

Never print key material, put it in a command argument recorded by shell
history, commit it, or pass it through a Workflow argument. Add it through the
approved secret-entry path. The cron never generates or modifies keys.

## Rotation and restoration lifecycle

The maintenance cron starts at most one `secretCryptoRotations` Workflow. Each
page scans at most 50 rows. An action decrypts, re-encrypts, and verifies the
round trip in memory. Its mutation receives only old/new ciphertext, re-reads
the row, validates the active execution fence, and performs a compare-and-swap.
Concurrent refresh, reconnect, or deletion wins and is counted as a conflict.
Workflow cancellation is reconciled through the shared execution control plane.

The following sequence records the completed k1-to-k2 migration and remains the
runbook for a future key rotation. Substitute the next key ID for `k2` during a
future rotation.

1. Deploy the optional schema, dual reader, strict writers, OpenRouter action,
   upload-token migration, Workflow, and observability with active `k1`, legacy
   reads set to `migrate`, and rotation mode `disabled`.
2. In dev, prove action writes, deterministic-mutation writes, wrong-AAD
   rejection, provider refresh/disconnect paths, and video upload replay.
3. Set rotation mode to `dry_run`. Require zero failures for both credential
   tables. Set it back to `disabled` after the run completes.
4. Set mode to `rotate` while active key remains `k1`. This rewrites plaintext
   and v1 rows as v2/k1. Verify zero plaintext/v1 rows and provider canaries.
5. Provision `k2` alongside `k1`; do not overwrite `k1`. Prove an internal k2
   encrypt/decrypt canary in dev and then production. The admin CLI can invoke
   `security/secret_rotation_actions:runSecretEncryptionCanary` with
   `{ "keyId": "k2" }`; the result contains metadata only and never returns the
   plaintext, ciphertext, or key material.
6. Change active key to `k2`, then set rotation mode to `rotate`. New writes use
   k2 immediately while the Workflow rewraps existing v2/k1 rows.
7. Require zero legacy/k1 rows, zero failures, settled conflicts, successful
   OAuth refresh/revoke and OpenRouter calls, and clean dashboards before setting
   legacy read mode to `disabled`.
8. Keep `k1` for at least 30 days and until the oldest restorable backup is
   newer than the completed rotation. Only then remove it from the live runtime.

Rollback after activating k2 changes only the active writer ID back to `k1`.
Do not deploy code that cannot read k2. Restoring an older database backup may
require temporarily restoring k1 and setting legacy read mode to `migrate`.

## Targeted credential invalidation

When specific users' stored credentials are exposed, the internal functions in
`convex/security/credential_invalidation.ts` delete them so each app prompts the
user to reconnect. They are internal only and are run by the owner with
`npx convex run`.

- `invalidateUsers { userIds, dryRun }` processes users sequentially (at most 200
  per call) and returns aggregate counts plus a per-user summary. Run
  `dryRun: true` first: it only reports what exists and contacts no provider.
- OpenRouter: deletes the `userSecrets` and `openRouterExchangeAttempts` rows
  (the same code as `deleteApiKey`); `MISSING_API_KEY` then triggers
  `reconnect_openrouter`.
- OAuth: Google, Notion and Slack tokens are revoked at the provider on a best
  effort basis, then every connection row is deleted (Google also deletes Drive
  file grants). A provider failure never blocks deletion.
- Microsoft (no revoke endpoint), Gmail manual and Apple Calendar (app
  passwords) and Cloze (API key) are deleted only. Their summary entries have
  `userActionRequired: true`: the user must revoke app access or rotate the
  credential at the provider. Failed revocations are flagged the same way.
- Summaries contain provider names, counts and short error codes, never token
  values.

## Account access blocks

One account-access fence covers every authentication path and background writer.
It checks the account-deletion tombstone and the `accountAccessBlocks` table.
When a user is blocked:

- `requireAuth` fails with the structured ConvexError code `ACCOUNT_BLOCKED`.
- Background writers, execution creation and attempt fences stop, but
  cancellation can still terminalize the user's work.
- Runtime Host credentials, upload tokens, schedule API triggers, linked channel
  identities and external MCP grants stop working.

Clients treat the code like `ACCOUNT_DELETION_IN_PROGRESS`: an ordinary error,
with no sign-out or token-refresh loop. The user can still delete their account.

The internal functions in `convex/security/account_access_blocks.ts` are run by
the owner with `npx convex run`:

- `blockUser { userId, reason, source? }` records the block. `source` defaults to
  `admin`. It then revokes every credential NanthAI issued to the account, 50 rows
  per page, continuing in the background until done:
  - external MCP grants and pending authorizations;
  - Runtime Host devices and pending pairings;
  - schedule trigger tokens;
  - linked channel identities and link grants;
  - push device tokens.

  It pauses the user's schedules and starts centralized cancellation of active runs.
- `unblockUser { userId, source? }` removes the block. Revoked credentials stay
  revoked and paused schedules stay paused; the user reconnects or resumes them.
  An `admin` block can only be lifted with the default source. An identity
  provider unban never lifts it.

### Identity provider webhook

`POST /clerk/webhook` receives Clerk events.

- **Verification.** The handler checks the Svix signature with
  `CLERK_WEBHOOK_SECRET` (HMAC-SHA256, five-minute timestamp window) before
  touching the database. Each delivery ID is applied once and kept for 24 hours.
  - Missing secret: 503.
  - Bad or stale signature: 401.
  - Ignored event types: 200.
- **`user.updated`.** A banned or locked user gets a block with source `clerk`.
  Lifting the ban or lock in Clerk removes a `clerk` block only.
- **`user.deleted`.** Writes the deletion tombstone, cancels the account's
  executions and purges its data through the normal account-deletion path.

Subscribe the endpoint to `user.updated` and `user.deleted`, and set the signing
secret as `CLERK_WEBHOOK_SECRET` in each deployment. Users who were already
banned, locked or deleted before the webhook was live need a one-time
`blockUser` (or deletion) by the owner.

## Video upload migration

New sessions store only a SHA-256 token hash and required expiry; jobs store the
upload session ID. The bounded production migration drained every legacy row.
The raw token fields, lookup indexes, migration function, and hourly cron were
then removed after aggregate audits confirmed zero remaining raw values.

## Required evidence for future production key changes

- Backend typecheck, zero-warning lint, and full Convex tests.
- Web typecheck, lint, tests, and production build.
- Android unit tests, lint, and build, plus affected UI smoke coverage.
- iOS simulator build and the Italian-locale focused/full tests.
- Dev deployment with credential, refresh, upload replay, malicious video URL,
  redirect, oversized response, and provider-error redaction canaries.
- After a production rotation, monitor rotation and decrypt-failure dashboards
  for seven clean days before declaring that rotation operationally settled.
  This observation window is not a substitute for the pre-deploy and live
  canaries above.
