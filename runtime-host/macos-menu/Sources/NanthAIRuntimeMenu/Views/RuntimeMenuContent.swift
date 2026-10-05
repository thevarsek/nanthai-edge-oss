import SwiftUI

@MainActor
public struct RuntimeMenuContent: View {
    @Bindable private var store: RuntimeMenuStore
    private let openSettings: @MainActor () -> Void
    private let openSavedWork: @MainActor () -> Void
    private let quit: @MainActor () -> Void

    public init(
        store: RuntimeMenuStore,
        openSettings: @escaping @MainActor () -> Void,
        openSavedWork: @escaping @MainActor () -> Void = {},
        quit: @escaping @MainActor () -> Void
    ) {
        self.store = store
        self.openSettings = openSettings
        self.quit = quit
        self.openSavedWork = openSavedWork
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            statusHeader
            RuntimeLoginControl(store: store)
            accountSummary
            monthlyAggregateSummary

            if let errorMessage = store.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()
            runtimeAction

            Button("Refresh") {
                Task { await store.refresh() }
            }
            .disabled(store.isRefreshing || store.isPerformingAction)

            Button("Saved tasks…", action: openSavedWork)
            Button("Settings…", action: openSettings)
            Divider()
            Button("Quit NanthAI", action: quit)
        }
        .padding(12)
        .frame(width: 280)
        .task {
            await store.refresh()
        }
    }

    private var statusHeader: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(store.snapshot.displayState, systemImage: store.snapshot.systemImage)
                .font(.headline)
            if let active = store.snapshot.activeSnapshot {
                Text("\(active.owner.displayName) · \(active.activeAttempts) active")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Runtime Host is not running")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var accountSummary: some View {
        if let account = store.account {
            VStack(alignment: .leading, spacing: 2) {
                Text(account.account.identity ?? account.account.authMethod.displayName)
                    .lineLimit(1)
                if let plan = account.account.plan {
                    Text(plan.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var monthlyAggregateSummary: some View {
        if let usage = store.monthlyUsage.first {
            VStack(alignment: .leading, spacing: 2) {
                Text(RuntimeUsageCopy.monthlyAggregateTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("\(usage.month) · \(usage.tokens.total.known.formatted()) tokens")
                    .font(.callout)
                if usage.unpricedReports > 0 {
                    Text("\(usage.unpricedReports) unpriced report(s)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var runtimeAction: some View {
        if store.snapshot.canStart {
            Button("Start Runtime Host") {
                Task { await store.startRuntime() }
            }
            .disabled(store.isPerformingAction)
        } else {
            Button("Stop Runtime Host") {
                Task { await store.stopRuntime() }
            }
            .disabled(store.isPerformingAction)
        }
    }
}
