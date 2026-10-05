# Billing and onboarding


### StoreKit 2 — Two-Phase Lifecycle

`StoreService` uses a deliberate two-phase lifecycle so StoreKit product data is available before Convex auth completes:

**Phase 1 — `startLocal()`**: Called from the onboarding carousel's `.task` (before sign-in). Loads the IAP non-consumable product (e.g. `<your-iap-product-id>`), checks `Transaction.currentEntitlements`, starts a `Transaction.updates` listener. Sets `isPurchased = true` if an active entitlement exists.

**Phase 2 — `connectConvex(_:)`**: Called after Convex auth completes. Wires in `ConvexService`. Any entitlement found in Phase 1 is held in `pendingSyncTransaction` and flushed immediately by calling `syncEntitlement` mutation.

**Revocation**: `Transaction.updates` detects `transaction.revocationDate != nil`. Sets `isPurchased = false`, calls `revokeEntitlement` Convex mutation → which sets `isMemoryEnabled: false`, `memoryGatingMode: "disabled"`, and schedules `purgeUserMemories` immediately.

### Pro Status

Pro is unlocked from the Convex entitlement state:
- `sharedStore.hasProEntitlement` — Convex reactive state from `preferences/queries:getProStatus`

StoreKit local state is not used as a second feature-gating source. It only exists to:
- drive the purchase / restore UI
- sync verified App Store transactions into Convex entitlements

This check is implemented in:
- `AppDependencies.isProUser` (computed property — used for imperative branching)
- `ProGateModifier` / `ProGatedNavigationLink` (used for SwiftUI view gating)

### Pro Gating — iOS Patterns

Two complementary patterns in `Views/Shared/ProGateModifier.swift`:

**Pattern A — `.proGated(feature:)` ViewModifier**: For free users, wraps content with `disabled(true).opacity(0.6)` and an invisible tap-intercepting overlay that presents `PaywallView` as a sheet. Used on buttons, toggles, and menu items. Full VoiceOver support.

**Pattern B — `ProGatedNavigationLink`**: For free users renders a `Button` that shows the paywall + appends `ProBadge()` to the label. For Pro users renders a normal `NavigationLink`. Used for settings sections and feature entry points.

**`ProBadge`**: Small "PRO" capsule label used in picker sections, settings rows, and navigation links to signal locked features.

### AppDependencies

```swift
@MainActor @Observable
final class AppDependencies {
    // ... existing services ...
    let store: StoreService                     // M14: StoreKit 2

    // Convex is the shared feature-entitlement source of truth
    var isProUser: Bool {
        sharedStore.hasProEntitlement
    }
}
```

`StoreService` is wired at construction: `sharedStore.notificationService = self.notifications` sets up the credit threshold evaluation pipeline. `store.startLocal()` is called from the onboarding carousel, not from `AppDependencies.init()`, to avoid blocking the DI container.

### Onboarding Coordinator Flow

```
App Launch
    ↓
RootView auth check:
  onboardingCompleted in UserDefaults?  ←— fast local check (no network)
  No → Show OnboardingView (coordinator)
  Yes → Normal auth state machine
    ↓
OnboardingView
  └── OnboardingCarouselView (.task → store.startLocal())
        Pages 1–4: value screens
        Page 5: Free vs Pro (live StoreKit purchase button)
        Page 6: "Get Started" → Sign In CTA
    ↓
  Clerk sign-in (ClerkKit UI)
    ↓
  AI connection choice: OpenRouter (PKCE) or Local Runtime (Pro)
    ↓
  OpenRouter: setOnboardingCompleted; local: completion after a successful turn
    ↓
  Main app
```

Returning users: `onboardingCompleted: true` in Convex preferences takes precedence over UserDefaults (handles reinstall / new device). Reconciliation: if Convex says completed but UserDefaults doesn't, write UserDefaults. If UserDefaults says completed, skip carousel without waiting for Convex.

### Convex Entitlement Mutations

| Mutation / Query | Purpose |
|-----------------|---------|
| `syncEntitlement({ originalTransactionId })` | Called after purchase. Idempotent — re-calling with same ID updates the App Store entitlement row in `purchaseEntitlements`. |
| `revokeEntitlement()` | Called on StoreKit revocation/refund. Revokes active App Store entitlement rows, disables Pro-only preference toggles, and schedules `purgeUserMemories`. |
| `setOnboardingCompleted()` | Called after OpenRouter key stored. Sets `onboardingCompleted: true`. |
| `getProStatus()` | Public query. Returns entitlement-backed Pro status for native client UI gating. |
| `checkProStatus` (internalQuery) | Takes `userId: string`. Used by generation actions for server-side Pro gating. |

**`requirePro(ctx, userId)`** in `convex/lib/auth.ts`: Resolves active entitlement state from `purchaseEntitlements` . Throws structured `PRO_REQUIRED` if false. Called from autonomous session start, memory extraction, advanced search, and scheduled job execution. Tool availability is gated separately: `buildProgressiveToolRegistry({ isPro: false })` returns an empty registry.

### PaywallView

Single-screen sheet (`Views/Shared/PaywallView.swift`). Presented when a free user taps a Pro-gated feature. Calls `store.retryLoadProductsIfNeeded()` on `.onAppear` to handle cases where Phase 1 product load failed. Auto-dismisses 0.8s after a successful purchase.

Feature list (8 items with SF Symbol icons): Personas, Autonomous Discussions, Memory, Ideascapes, Advanced Search, AI Tools, Provider Integrations, Knowledge Base, Document Uploads, Scheduled Jobs.

### Local Runtime purchase and setup

After account creation, the connection choice labels Local Runtime as Pro. Its
entry points in onboarding, Settings and the Mac pairing browser handoff use the
existing purchase/restore UI before starting new setup or pairing. OpenRouter
remains the free connection path. The one-time NanthAI purchase does not include
AI-provider usage or subscriptions.

Each client retains the requested action while the purchase is in progress and
continues only when Convex confirms an active entitlement. Cancellation returns
to the connection choice or retained settings; it never performs the pending
action. Web checkout returns to its originating setup or Mac handoff, preserving
the handoff state. iOS starts Pro-status subscription and StoreKit-to-Convex sync
after sign-in, before either AI connection exists.

Convex checks Pro when starting local setup, creating a pairing code or explicitly
adding a basic local Persona. Starter provisioning skips free accounts and resumes
for eligible paired computers when setup is retried or the host next heartbeats.
Persisted setup intent still permits account/history access for recovery; device
information, offline status and removal remain accessible without Pro. Existing
free local-only users are offered purchase or an OpenRouter connection.

Generated local Personas have the editable system message `You are a helpful
assistant.`. Editors require a nonempty message for both local and cloud Personas;
users may replace the prefilled text with their own instructions. Repeated setup
and heartbeats preserve edited messages and do not resurrect deleted Personas.

### Account Deletion — 4-Step Sequence

Implemented in `SettingsViewModel+Account`:

1. `notifications.removeToken()` — while Convex session is still valid
2. `account/actions:deleteAccount` Convex action — cascades through all user tables
3. `authService.deleteAccount()` — Clerk user deletion + Keychain wipe
4. Reset local credit/notification state in `SharedAppDataStore` and `CreditBalanceCheck`

Required by Apple guideline 5.1.1(v). GDPR right-to-erasure compliant.

### Local Credit Notifications

Architecture: `CreditBalanceCheck` (pure struct, threshold logic) + M14 additions to `NotificationService` (scheduling) + `SettingsNotificationsSection` (user toggle).

Pipeline: `SharedAppDataStore.updateCreditBalance(_:)` → `evaluateCreditThresholds()` → `CreditBalanceCheck.crossedThreshold(balance:)` → `notifications.scheduleCreditAlert(threshold:)` → `CreditBalanceCheck.markNotified(threshold:)`.

Thresholds: `[1.00, 0.50, 0.10]` (£). Notified once per threshold per balance dip (UserDefaults-persisted). Auto-clears when balance rises above. Permission requested on first crossing (not during onboarding).

---
