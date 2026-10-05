import SwiftUI

@MainActor
public struct RuntimeSettingsContent: View {
    @Bindable private var store: RuntimeMenuStore
    @Environment(\.dismiss) private var dismiss

    public init(store: RuntimeMenuStore) {
        self.store = store
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings & usage").font(.headline)
                Spacer()
                Button("Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding()
            Form {
                Section("Runtime Host") {
                    LabeledContent("Status", value: store.snapshot.displayState)
                    if let active = store.snapshot.activeSnapshot {
                        LabeledContent("Owner", value: active.owner.displayName)
                        LabeledContent("Active work", value: active.activeAttempts.formatted())
                        LabeledContent("Queued events", value: active.queuedEvents.formatted())
                    }
                }

                Section("NanthAI usage · all runtimes") {
                    Text("Reported tokens and costs from Codex and Pi tasks on this Mac. Provider subscription allowances are separate.")
                        .font(.caption).foregroundStyle(.secondary)
                    if store.monthlyUsage.isEmpty {
                        Text("No local usage reports yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        RuntimeUsageChart(usage: store.monthlyUsage)
                        ForEach(store.monthlyUsage) { usage in
                            MonthlyUsageAggregateRow(usage: usage)
                        }
                    }
                }

                if let account = store.account {
                    Section("Codex account limits") {
                        LabeledContent("Authentication", value: account.account.authMethod.displayName)
                        LabeledContent("Identity", value: account.account.identity ?? "Unavailable")
                        LabeledContent("Plan", value: account.account.plan?.capitalized ?? "Unavailable")
                        if let limits = account.rateLimits, limits.primary != nil || limits.secondary != nil {
                            RuntimeAccountUsageChart(limits: limits)
                        } else {
                            Text("Codex account usage is unavailable.").foregroundStyle(.secondary)
                        }
                    }
                }


                if let errorMessage = store.errorMessage {
                    Section("Error") {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 460, minHeight: 380)
            .scenePadding()
            .task {
                await store.refresh()
            }
        }
    }
}

private struct MonthlyUsageAggregateRow: View {
    let usage: MonthlyUsageAggregate

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(usage.month)
                    .font(.headline)
                Spacer()
                Text([usage.provider, usage.modelID].compactMap { $0 }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
            }
            Text("\(usage.tokens.total.known.formatted()) reported tokens · \(usage.turnReports) report(s)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Input \(usage.tokens.input.displayValue) · Output \(usage.tokens.output.displayValue) · Cached input \(usage.tokens.cachedInput.displayValue)")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(Array(usage.costs.enumerated()), id: \.offset) { _, cost in
                Text(costDescription(cost))
                    .font(.caption)
            }
            if usage.unpricedReports > 0 {
                Text("\(usage.unpricedReports) unpriced report(s)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }

    private func costDescription(_ cost: MonthlyUsageCost) -> String {
        let amount = cost.amount.formatted(.currency(code: cost.currency))
        return "\(cost.source.displayName): \(amount)"
    }
}
