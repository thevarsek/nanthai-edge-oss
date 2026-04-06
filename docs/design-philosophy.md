# Design Philosophy & Product Vision

> NanthAI Edge is a dual-native mobile product for AI-powered conversations.

## Overview

NanthAI Edge replaces a React + Supabase web app (chatology-nanthai, 200+ users) with native iOS and Android apps backed by Convex. iOS remains the primary visual design reference for conversation ergonomics, while Android follows platform-native interaction patterns against the same backend behavior. **Minimum iOS deployment target: iOS 26.0+** (current SDK baseline 26.2).

## Core Features (Priority Order)

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Streaming Chat** | Real-time SSE streaming to one or more AI models via OpenRouter |
| 2 | **Multi-Model Chat** | Send a single prompt to 2-3 models simultaneously, display side-by-side |
| 3 | **Ideascapes** | Visual graph canvas for branching conversations — nodes positioned in 2D space with connectors |
| 4 | **Personas** | Full AI alter-egos with locked model assignment, custom avatar (emoji/SF Symbol), definition (system prompt), and parameter overrides — assigned as chat participants |
| 5 | **Internet Search** | Multi-tier internet search (`basic`, `web`, `paper`) with lightweight search and deep research flows |
| 6 | **Convex-Backed Runtime** | Long-running generation + tool execution continue while app is backgrounded, with realtime UI updates |
| 7 | **Folder Organization** | Chats organized into user-created folders |
| 8 | **OpenRouter OAuth PKCE** | Native auth flow — user gets their own API key, stored in Keychain |

## Design Philosophy — iMessage as Golden Standard

The iOS app's UI language follows Apple iMessage as the primary design reference. Every screen should feel like it belongs in Apple's own Messages app: minimal chrome, content-first, instantly familiar. Android should preserve behavioral parity without copying Apple-specific layout conventions literally.

### Conversation List (Main Screen)

- Clean list of conversations, most-recent first — just like iMessage's main view
- Each row: title (or first message preview), timestamp, subtle preview text
- Bottom bar: search field on the left, compose (new chat) button on the right
- Top bar: "Filter" button (left) for folders/personas, "Settings" gear (right)
- Swipe actions on rows: archive, delete, pin — same gestures as iMessage
- No sidebar on iPhone — full-screen list. iPad gets NavigationSplitView with sidebar.

### Inside a Chat

- Messages scroll vertically, user messages right-aligned (blue bubbles), AI left-aligned (gray bubbles) — iMessage layout
- Minimal top bar: back chevron, chat title (tappable for details), model indicator
- Bottom input area: "+" button (left) for attachments/options/persona/tools, text field (center), send button (right, appears when text is present)
- "+" menu reveals: attach file, select persona, select model, ideascape, internet search, tool actions
- Typing/streaming indicator: animated dots (like iMessage "..." indicator) while AI is generating
- No clutter — no permanent toolbars, no floating buttons, no visible settings in chat

### General Principles

- White/system background, no gratuitous colors or gradients
- SF Symbols exclusively for icons — no custom icon assets
- System fonts (San Francisco) at standard Dynamic Type sizes
- Minimal use of borders/dividers — spacing and grouping do the work
- Haptic feedback on key actions (send, delete, long-press)
- Animations: subtle, spring-based, never flashy
- Dark mode: automatic via system, no custom theming

## Non-Goals (v1)

- No Supabase dependency — all persistence and orchestration run through Convex
- No dedicated Netlify backend layer — backend execution is consolidated in Convex
- No subscription billing — one-time Pro unlock via App Store / Play Store; LLM costs managed directly on OpenRouter
- No web rewrite in this repo — product focus is native iOS + native Android

---

*Source: Extracted from `plan.md` §1 — Product Vision & Goals*
