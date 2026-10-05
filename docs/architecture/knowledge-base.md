# Knowledge Base and Google file access


Google's restricted-scope verification request for broad Drive/Gmail OAuth is no longer the product direction. NanthAI has aligned Cloud Console and the verification submission to the narrowed runtime scope set below and sent the reduced-scope reply. The remaining launch gate is Google's go-ahead. See `docs/integrations/google-reduced-scopes-launch.md` for the operational checklist.

### Runtime OAuth scopes (5 only)

The `google` provider in `oauthConnections` was narrowed to the minimum scopes required for shipped surfaces:

1. `openid`
2. `https://www.googleapis.com/auth/userinfo.email`
3. `https://www.googleapis.com/auth/userinfo.profile`
4. `https://www.googleapis.com/auth/drive.file` (Drive Picker — per-file grants only, no broad Drive read)
5. `https://www.googleapis.com/auth/calendar.events`

Gmail full-mailbox `gmail.modify` / `gmail.send` scopes were **removed** from the OAuth flow. Gmail integration now ships exclusively as **`gmail_manual`** (IMAP/SMTP credentials supplied directly by the user) — backed by `convex/oauth/gmail_manual.ts` and stored as a row in the existing `oauthConnections` table (no new table). This avoids Google's restricted-scope verification process for the Gmail API.

### Drive Picker (`drive.file` + per-file grants)

Because `drive.file` only grants access to files the user explicitly opens via the Picker, we maintain a per-user grant cache in `googleDriveFileGrants` that records every file the user has ever picked, plus a cached copy of the file bytes in Convex `_storage`. This lets background flows (model turns, KB queries, scheduled jobs) operate on the file without re-prompting the user.

The picker itself runs in a browser context — both iOS and Android open `nanthai-edge://drive-picker` via a system browser deeplink and receive picked file IDs back via the deeplink return path. The web client uses Google's JavaScript Picker API directly.

### Mid-generation pause/resume (`requiresDrivePicker`)

When a tool call needs a Drive file the user hasn't picked yet, the generation pipeline:

1. Persists the in-flight participant/params/tool-call snapshot into `drivePickerBatches`
2. Returns a `requiresDrivePicker` payload to the client (with the batch id)
3. Client opens the picker; on completion posts picked file ids back via `drive_picker/mutations:attachPickedDriveFiles`
4. Backend resumes the generation from the persisted snapshot

This is the only "pause and ask the user" pattern in the generation pipeline — distinct from subagent batches, which run autonomously.

---



### Module relocation: `convex/chat/` → `convex/knowledge_base/`

Knowledge Base queries/mutations/actions previously lived under `convex/chat/`. Phase 6 relocated them into a dedicated `convex/knowledge_base/` module with no back-compat shim (dev-only deployment policy):

- `queries.ts` — `listKnowledgeBaseFiles`, `getKnowledgeBaseFilesByStorageIds`, `getFileAttachmentInternal`, `getFileAttachmentByStorageInternal`
- `mutations.ts` — `addUploadToKnowledgeBase`, `deleteKnowledgeBaseFile`, `insertDriveImport`, `updateDriveAttachmentStorage`
- `mutations_args.ts` — Zod arg validators
- `actions.ts` — `importDriveFileToKnowledgeBase`, `refreshDriveStorageIfStale`

### KB as a virtual view

Knowledge Base is **not a separate table**. It is a virtual projection over three existing tables:

- `fileAttachments` — uploaded files + Drive imports (KB rows have no `chatId`/`messageId`)
- `generatedFiles` — AI-generated artifacts the user pinned to KB
- `generatedMedia` — generated audio/video the user pinned to KB

The `source` discriminator (`"upload"` / `"generated"` / `"drive"`) is **derived** at query time:

- `"drive"` ⇔ FA row has `driveFileId` set
- `"upload"` ⇔ FA row with no `driveFileId`
- `"generated"` ⇔ row in `generatedFiles` or `generatedMedia`

Clients pass `source` to `deleteKnowledgeBaseFile` so the backend knows which underlying table to delete from.

### Single chokepoint for FA inserts

All FA row inserts now go through `convex/lib/file_attachments.ts:insertFileAttachment` — including chat uploads, Drive picker imports, KB imports, and OAuth-flow ingestion. The same module exports `deleteDriveGrantCacheForStorage`, the single point where Drive grant cache rows get cleaned up when their cached storage id is invalidated. This ensures consistent normalization (e.g., always setting `createdAt`) and a single audit point.

### Single chokepoint for Drive metadata + bytes

`convex/drive_picker/ingest.ts` consolidates the Drive-API metadata fetch + bytes download. Both the chat-flow Drive picker (`drive_picker/actions.ts`) and the KB import flow (`knowledge_base/actions.ts`) call into it. Previously each flow had its own copy.

### Lazy refresh chokepoint: `getKBFileContents`

When a model loads KB file contents during generation, `scheduledJobs/queries.ts:getKBFileContents` is the single point where stale Drive bytes get refreshed:

1. Resolve the FA row via `getFileAttachmentByStorageInternal` (uses the new `by_storage` index)
2. If `driveFileId` is set, call `refreshDriveStorageIfStale` — this fetches Drive's current `modifiedTime` and re-ingests bytes if it has advanced past `lastRefreshedAt`
3. If a refresh occurred, swap the FA row's `storageId` to the new ingest before reading content

The refresh path is **strict** — it throws on Drive HTTP errors rather than serving stale bytes silently. Per-id error isolation lives in `getKnowledgeBaseFilesByStorageIds` so one failed Drive file doesn't kill the whole KB content load.

### Cross-platform parity

All three clients (web, iOS, Android) use the same KB Convex paths:

- Settings KB upload → `addUploadToKnowledgeBase` after `POST /upload-url` (fixed orphan `_storage` rows on web)
- Settings KB Drive import → `importDriveFileToKnowledgeBase` (lifts files into KB; FA gets `driveFileId` set, no chat/message ids)
- Chat KB picker → reuses the same `listKnowledgeBaseFiles` + `getKnowledgeBaseFilesByStorageIds` queries; its "Import from Drive" button writes to KB but does NOT auto-attach to the message (parity with iOS/web)
- KB delete → `deleteKnowledgeBaseFile({ storageId, source })`

Android routes the Drive-picker deeplink callback through an app-wide `DrivePickerCallbackBus` (`SharedFlow` singleton, `replay=0`) so whichever surface launched the picker (chat, KB Settings, etc.) receives the result. iOS uses `NotificationCenter` for the same purpose. The OnePick helper logic itself is shared — `app/DrivePickerOnePick.kt` on Android, `Views/Settings/KBDriveImportSheet.swift` + chat-side equivalents on iOS — and both copy-paste the picker invocation pattern rather than refactor it (deliberate choice to keep flows independently debuggable).

---
