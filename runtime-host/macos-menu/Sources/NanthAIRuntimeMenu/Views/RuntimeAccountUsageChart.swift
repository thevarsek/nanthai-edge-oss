import SwiftUI

struct RuntimeAccountUsageChart: View {
    let limits: RuntimeAccountRateLimits

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(limits.limitName ?? "Codex account usage").font(.headline)
            if let primary = limits.primary { window(primary, fallback: "Primary window") }
            if let secondary = limits.secondary { window(secondary, fallback: "Secondary window") }
            Text("Reported by Codex for your account, including use outside NanthAI.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }

    private func window(_ value: RuntimeAccountRateWindow, fallback: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ProgressView(value: value.chartFraction) {
                HStack {
                    Text(value.windowDurationMins.map { "\($0.formatted())-minute window" } ?? fallback)
                    Spacer()
                    Text("\(value.usedPercent.formatted())% used")
                }
            }
            if let resetsAt = value.resetsAt {
                Text("Resets \(Date(timeIntervalSince1970: resetsAt).formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
