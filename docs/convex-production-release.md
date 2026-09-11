# Automated Convex production release

`.github/workflows/convex-production.yml` runs on every push to `main`, including
merged pull requests. It also supports a manual run from `main` in GitHub Actions.
Once configured and merged, pushing to `main` authorizes a production backend
release without a separate manual deployment.

## One-time setup

Create a production deploy key for this project's production deployment in
Convex. Store it as the private repository's Actions secret `CONVEX_DEPLOY_KEY`.
Do not use a personal access token, development key, or preview key. The workflow
checks the key's deployment prefix before doing any work.

Merge the workflow and run **Convex Production** from `main`. Confirm that the
deployment and production checks succeed; local validation alone does not prove
the GitHub secret, runner, or production access is configured correctly.

## Execution

1. Install backend dependencies. The root lockfile is currently ignored, so this
   uses `npm install --no-package-lock`; dependencies resolve from the ranges in
   `package.json`, rather than a frozen dependency tree.
2. Run backend typecheck, lint with zero warnings, backend tests, and smoke-check
   regression tests.
3. Confirm the triggering commit is still `origin/main`. Skip superseded commits
   and old manual reruns rather than deploying them over newer code.
4. Deploy functions, schema, and indexes with typechecking enabled. Record the
   commit SHA in the deployment message.
5. Query production health and the model catalog with omitted, false, and true
   `includeGenerationModels` arguments. Confirm the catalog exposes image, music,
   speech, and video capabilities.

Deployments share one concurrency group and running jobs are not interrupted.
GitHub may replace a pending run with a newer push; the latest `main` is the
release target. Other production deployment mechanisms must not run concurrently.

## Failures and boundaries

A failed check fails the Actions run and records a summary. GitHub Actions
notification delivery depends on each maintainer's GitHub notification settings;
this workflow does not configure email or chat alerts.

If deployment succeeds but a smoke check fails, the code is already live. Inspect
the failed step and fix forward. Do not automatically roll back schemas: newer
clients or persisted data may require the new contract.

This workflow deploys backend code. Data migrations and system skill catalog
updates remain explicit release steps. In particular, do not blindly run
`skills/actions:seedSystemCatalog` on every push: its current implementation
updates skill versions and removes retired skills and their saved references.
Add the specific data step and its verification when a release requires one.

Netlify and native release workflows currently remain independent. This change
prevents forgetting the backend deployment, but does not make clients wait for
it or eliminate the short deployment-order window. Coordinating client
publication with this workflow is a separate release-pipeline change.

## Local checks

```sh
node --test scripts/convex_production_smoke.test.mjs
CONVEX_PRODUCTION_URL=https://YOUR-PRODUCTION.convex.cloud node scripts/convex_production_smoke.mjs
```

The live checks are public read-only queries and do not generate paid media,
impersonate users, or change production data.
