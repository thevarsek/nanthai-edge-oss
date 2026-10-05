import Charts
import SwiftUI

public struct RuntimeUsageChart: View {
    let usage: [MonthlyUsageAggregate]

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Reported tokens by month").font(.headline)
            Chart(usage) { report in
                BarMark(
                    x: .value("Month", report.month),
                    y: .value("Reported tokens", report.tokens.total.known)
                )
                .foregroundStyle(by: .value("Model", report.modelID ?? "Unknown model"))
                .accessibilityLabel("\(report.month), \(report.modelID ?? "Unknown model")")
                .accessibilityValue("\(report.tokens.total.known.formatted()) reported tokens")
            }
            .chartXScale(domain: Array(Set(usage.map(\.month))).sorted())
            .frame(height: 180)
            Text("Token totals reported by NanthAI turns. Unreported tokens and subscription allowances are not included.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}
