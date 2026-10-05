import Foundation
import Observation

@MainActor
@Observable
public final class RuntimeMenuStore {
    public private(set) var snapshot: RuntimeHostSnapshot
    public private(set) var monthlyUsage: [MonthlyUsageAggregate]
    public private(set) var account: AdapterAccountSnapshot?
    public private(set) var runAtLoginEnabled: Bool
    public private(set) var isRefreshing = false
    public private(set) var isPerformingAction = false
    public private(set) var errorMessage: String?

    @ObservationIgnored
    private let snapshotReader: any RuntimeSnapshotReading
    @ObservationIgnored
    private let usageReader: any RuntimeUsageReading
    @ObservationIgnored
    private let accountReader: any RuntimeAccountReading
    @ObservationIgnored
    private let supervisor: any RuntimeHostSupervising
    @ObservationIgnored
    private let loginItem: any LoginItemControlling

    public init(
        snapshotReader: any RuntimeSnapshotReading,
        usageReader: any RuntimeUsageReading,
        accountReader: any RuntimeAccountReading,
        supervisor: any RuntimeHostSupervising,
        loginItem: any LoginItemControlling,
        initialSnapshot: RuntimeHostSnapshot = .offline(
            OfflineRuntimeHostSnapshot(paired: false, deviceID: nil)
        )
    ) {
        self.snapshotReader = snapshotReader
        self.usageReader = usageReader
        self.accountReader = accountReader
        self.supervisor = supervisor
        self.loginItem = loginItem
        snapshot = initialSnapshot
        monthlyUsage = []
        account = nil
        runAtLoginEnabled = false
    }

    public func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            async let nextSnapshot = snapshotReader.readSnapshot()
            async let nextUsage = usageReader.readAllMonthlyAggregates()
            async let nextLoginItemState = loginItem.isEnabled()
            let values = try await (
                nextSnapshot,
                nextUsage,
                nextLoginItemState
            )
            snapshot = values.0
            monthlyUsage = values.1
            runAtLoginEnabled = values.2
            errorMessage = nil
        } catch {
            errorMessage = Self.publicMessage(for: error)
        }
        // Codex allowances are informational; Pi-only hosts still have canonical usage.
        do { account = try await accountReader.readAccount() }
        catch { account = nil }
    }

    public func startRuntime() async {
        await performAction {
            try await supervisor.start(owner: .tray)
        }
    }

    public func refreshLoginPreference() async {
        do { runAtLoginEnabled = try await loginItem.isEnabled() }
        catch { errorMessage = Self.publicMessage(for: error) }
    }

    public func refreshSnapshot() async {
        do { snapshot = try await snapshotReader.readSnapshot() }
        catch { errorMessage = Self.publicMessage(for: error) }
    }

    public func stopRuntime() async {
        await performAction {
            try await supervisor.stop()
        }
    }

    public func setRunAtLogin(_ enabled: Bool) async {
        guard !isPerformingAction else { return }
        isPerformingAction = true
        defer { isPerformingAction = false }
        do {
            try await loginItem.setEnabled(enabled)
            runAtLoginEnabled = try await loginItem.isEnabled()
            errorMessage = nil
        } catch {
            errorMessage = Self.publicMessage(for: error)
        }
    }

    public func clearError() {
        errorMessage = nil
    }

    private func performAction(_ action: () async throws -> Void) async {
        guard !isPerformingAction else { return }
        isPerformingAction = true
        do {
            try await action()
            errorMessage = nil
        } catch {
            errorMessage = Self.publicMessage(for: error)
        }
        isPerformingAction = false
        await refresh()
    }

    private static func publicMessage(for error: Error) -> String {
        let description = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return description.isEmpty ? "The Runtime Host action failed." : description
    }
}
