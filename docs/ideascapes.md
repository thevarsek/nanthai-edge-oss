# Ideascapes — Branch Graph + Spatial Canvas Architecture

> Authoritative architecture reference for branch-aware chat and ideascape canvas behavior.

## Core Concept

Every chat is a message graph rendered in two synchronized modes:

- **Chat Mode**: linear list of the active branch path.
- **Ideascape Mode**: 2D canvas showing all nodes and parent-child edges.

The graph is backed by `messages.parentMessageIds` (multi-parent capable, String arrays). `chats.activeBranchLeafId` remains the single persisted focus node syncing modes, but branch pills no longer compute the next leaf client-side. Clients call a canonical Convex fork-switch mutation that resolves the next leaf for the selected divergence point. Chats use the `mode` field (`chatMode` validator: `"chat"` or `"ideascape"`) to distinguish mode.

## Data Model (Convex)

### `chats` table

- `activeBranchLeafId: v.optional(v.id("messages"))` — current focus node
- `mode: chatMode` — `"chat"` or `"ideascape"` (replaces former `isIdeascape` boolean)

Viewport state is **not** stored on the chat table. Canvas pan/zoom is ephemeral in `ChatViewModel+IdeascapeViewport.swift`.

### `messages` table

- `parentMessageIds: v.optional(v.array(v.id("messages")))` — ordered parent IDs; supports multi-parent context and connectors
- First element is the primary structural parent; additional elements are secondary context parents

### `nodePositions` table

- `chatId: v.id("chats")`, `messageId: v.id("messages")` — one row per placed node
- `x`, `y`, `width`, `height` — canvas placement (persisted via `IdeascapeNodePositionSync`)
- Index: `by_chat` for efficient per-chat lookups

### iOS DTOs

```swift
struct ConvexChat: Codable {
    let mode: String?           // "chat" or "ideascape"
    let activeBranchLeafId: String?
}

struct ConvexNodePosition: Codable {
    let _id: String
    let chatId: String
    let messageId: String
    let x: Double
    let y: Double
    let width: Double?
    let height: Double?
}
```

## Send Semantics

### Chat Mode

- No explicit selection is required.
- `ChatViewModel.sendMessage` derives parent IDs from `activeBranchLeafId` via Convex backend (`chat/mutations:sendMessage`).
- If the active leaf belongs to a `multiModelGroupID` and expansion is enabled, all siblings in that group are added as parent IDs (active leaf first).

### Ideascape Mode

- User must select at least one node.
- Selected node IDs are passed as `explicitParentMessageIDs`.
- `expandMultiModelGroups` is disabled so only selected lineage is used.

## Branch Path and Sibling Detection

### Active Path

`ChatViewModel.activeBranchPath`:

1. Starts from `activeBranchLeafID` (or latest leaf fallback).
2. Walks ancestry through **all** parent IDs with cycle guards.
3. Expands touched multi-model groups for stable grouped rendering.
4. Sorts by `createdAt` for display.

### Fork Switching

- Branch pills represent a specific sibling family at one divergence point.
- Clients call `chat/manage:switchBranchAtFork` with the current active sibling and the target sibling for that fork.
- Convex resolves the new `activeBranchLeafId` by replaying the current downstream branch choices onto the target sibling as far as possible.
- If the target subtree cannot support the same downstream choices, Convex falls back deterministically to the earliest available continuation from the first unmatched level.
- This keeps fork semantics shared across iOS, Android, and web while preserving `activeBranchLeafId` as the single source of truth.

### Branching Detection

- Siblings are peers with overlapping direct parent IDs and matching role.
- Same `multiModelGroupID` members are treated as one grouped response, not branch divergence.
- Partial-overlap multi-parent branches (subset/superset parent sets) are treated as valid sibling branches.

## Request Context Building

`convex/chat/helpers.ts` — `buildRequestMessages`:

1. Builds ancestry ID set via multi-parent traversal.
2. Applies cycle guards for legacy self-references.
3. Optionally expands multi-model siblings (`expandMultiModelGroups`).
4. Deduplicates shared ancestors naturally through visited IDs.
5. Filters to contextual messages only, preventing cross-branch contamination.

iOS-side context resolution is extracted into `IdeascapeContextResolver.swift` (post-M14).

## Canvas Rendering

### Layout

`IdeascapeLayoutEngine.swift` uses tree placement based on primary structural parent (`parentMessageIds[0]`) for deterministic coordinates:

- depth-based rows
- sibling horizontal spreading
- multi-model sibling handling and promotion when descendants exist
- existing user-dragged positions preserved

### Connectors

`ConnectorLayerView` iterates all `message.parentMessageIDs` and renders one orthogonal connector per parent edge.

This reflects multi-parent context directly on canvas (not only first parent).

### Interaction

- Pan + zoom gestures
- Node dragging with debounced persistence via `IdeascapeNodePositionSync`
- Viewport state managed in `ChatViewModel+IdeascapeViewport.swift` (ephemeral)
- Multi-select node state used by ideascape sends

## Compatibility Notes

- All IDs are Convex document strings (SwiftData `UUID` types removed in M8)
- Single-parent compatibility maintained: first element of `parentMessageIds` is the primary parent
- Historical corrupted self-parent rows are guarded at traversal time

## Regression Coverage

### iOS Tests
- `NanthAi-EdgeTests/Utilities/IdeascapeCanvasGeometryTests.swift` — canvas geometry calculations (post-M14)
- `NanthAi-EdgeTests/Utilities/IdeascapeContextResolverTests.swift` — context resolution logic (post-M14)
- `NanthAi-EdgeTests/Utilities/IdeascapeNodePositionSyncTests.swift` — position sync utilities (post-M14)

### iOS Source Files (post-M14 hardening)
- `Utilities/IdeascapeContextResolver.swift` — unified ideascape context resolution
- `Utilities/IdeascapeCanvasGeometry.swift` — extracted canvas geometry calculations
- `Utilities/IdeascapeNodePositionSync.swift` — node position sync utilities
- `Views/Ideascape/IdeascapeContextBreakdownView.swift` — context token breakdown per selected node
- `Views/Ideascape/IdeascapeContextSummaryView.swift` — compact context summary bar
- `Views/Ideascape/IdeascapeHelpDeckView.swift` — in-canvas help deck with gesture/feature guide

*Last updated: 2026-03-17 — Rewrote data model section for Convex (post-M8), replaced UUID/ChatService references, added post-M14 hardening files, fixed test paths.*
