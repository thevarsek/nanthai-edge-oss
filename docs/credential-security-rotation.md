# Credential encryption and rotation runbook

This milestone encrypts OAuth credentials and OpenRouter keys with AES-256-GCM
and contextual authenticated data. It protects against database-only disclosure;
it does not protect credentials if both the Convex runtime and its environment
keys are compromised.

## Current deployed state

The format migration and k2 rotation completed in development and production on
2026-07-31.

- `k2` is the active writer in both environments, using different key material.
- Legacy plaintext and `enc:v1` reads are disabled.
- Automatic rotation is disabled until an operator deliberately starts another
  documented rotation.
- Production has 62 credential rows: all are `enc:v2`/`k2`, with zero plaintext,
  `enc:v1`, or `k1` rows.
- `k1` remains configured only for rollback and restoration of older backups. It
  must remain until both the 30-day and backup-retention conditions are met.
- The raw video-upload-token compatibility fields, indexes, migration and cron
  have been removed. Video jobs also no longer persist polling URLs; provider
  endpoints are constructed locally from the stable provider job ID.

The backend deployment is live. Updated clients use the server-side OpenRouter
exchange, while `scheduledJobs/mutations:upsertApiKey` remains as an encrypted
compatibility path for released clients.

## Environment contract

| Variable | Purpose |
|---|---|
| `CONVEX_SECRET_ENCRYPTION_KEY` | Retained `k1` material for rollback/restored backups. Do not change before the retention gate. |
| `CONVEX_SECRET_ENCRYPTION_KEY_K2` | Active independently generated 32-byte key material. |
| `CONVEX_SECRET_ENCRYPTION_ACTIVE_KID` | Active writer key ID; currently `k2`. |
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
