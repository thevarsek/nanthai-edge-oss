# Google Reduced Scopes Launch Readiness

> Canonical operational status for the M24 Google scope-narrowing branch.

## Current Status

NanthAI is ready on the application side for the reduced Google OAuth scope launch. The remaining blocker is Google's go-ahead on the updated verification thread/submission.

This branch no longer depends on restricted Google Drive or Gmail OAuth scopes. The product now uses:

- Google OAuth for identity, Drive file access via explicit user selection, and Calendar events.
- Google Drive `drive.file` with Picker/OnePick grants and cached per-file access.
- Google Calendar `calendar.events` for event-level list/create/delete flows.
- Manual Gmail (`gmail_manual`) over IMAP/SMTP app password, separate from Google OAuth.

## Final Google OAuth Scope Set

Runtime clients and Cloud Console should request only:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/calendar.events
```

Do not reintroduce any of these scopes without reopening Google verification/CASA planning:

- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/calendar`
- any Gmail OAuth scope, including `https://www.googleapis.com/auth/gmail.modify`

## Launch Gate

Waiting on Google only:

- Google Cloud OAuth consent screen scopes are aligned to the final 5-scope set.
- Google verification submission scopes are aligned to the final 5-scope set.
- The broader Drive, broader Calendar, and Gmail OAuth scopes have been removed from the Google submission.
- The reply confirming narrower scopes has been sent.
- Production deploy remains deferred until Google gives the go-ahead and this branch merges to `main`.

## Product Behavior To Demo

Use this flow if Google asks for a verification video:

1. OAuth consent screen shows only identity, `drive.file`, and `calendar.events`.
2. Connect Google.
3. Use Calendar list/create/delete with event-level access.
4. Ask for a Drive file; NanthAI prompts Picker/OnePick instead of silently searching Drive.
5. Select a file through Picker/OnePick; NanthAI reads/summarizes the selected file.
6. Show that Gmail is not part of Google OAuth.
7. Optional: show Manual Gmail setup as a separate app-password flow, clearly distinct from Google OAuth.

## Implementation Invariants

- Convex remains the source of truth for integration availability and tool routing.
- Gmail tools require `gmail_manual`, not a Google OAuth connection.
- Drive tools require Google OAuth plus explicit Picker/OnePick file grants or app-created files.
- Calendar tools require Google OAuth with `calendar.events`.
- Clients must not show integration toggles for providers/capabilities that are not connected.
- Whole-Drive search, broad Drive organization, and OAuth Gmail management remain deferred.

## Operational References

- Milestone detail: [`../milestones/M24-google-coming-soon.md`](../milestones/M24-google-coming-soon.md)
- Shared client contract: [`mobile-api-contract.md`](mobile-api-contract.md)
- Tool and skill gates: [`tool-skill-access.md`](tool-skill-access.md)
- Data model: [`data-model.md`](data-model.md)

## Last Verified

- Date: 2026-04-27
- Branch: `codex/m24-google-narrow-scopes-gmail-drive`
- Status: application-side ready; Google go-ahead pending.
