import Foundation
import Testing
@testable import NanthAIRuntimeMenu

@Suite("Runtime menu store")
@MainActor
struct RuntimeMenuStoreTests {
    @Test
    func initializationHasNoLifecycleSideEffectsAndRefreshKeepsAllMonths() async {
        let loginItem = FakeLoginItemController()
        let supervisor = FakeRuntimeHostSupervisor()
        let store = makeStore(loginItem: loginItem, supervisor: supervisor)

        let writesBeforeRefresh = await loginItem.writes()
        let startsBeforeRefresh = await supervisor.starts()
        #expect(writesBeforeRefresh.isEmpty)
        #expect(startsBeforeRefresh.isEmpty)

        await store.refresh()

        #expect(store.monthlyUsage.map(\.month) == ["2026-08", "2025-01"])
        #expect(store.snapshot.activeSnapshot?.owner == .tray)
        #expect(store.account?.account.plan == "pro")
        let writesAfterRefresh = await loginItem.writes()
        #expect(writesAfterRefresh.isEmpty)
    }

    @Test
    func explicitStartUsesTrayOwnership() async {
        let loginItem = FakeLoginItemController()
        let supervisor = FakeRuntimeHostSupervisor()
        let store = makeStore(loginItem: loginItem, supervisor: supervisor)

        await store.startRuntime()

        let starts = await supervisor.starts()
        #expect(starts == [.tray])
    }

    @Test
    func loginItemChangesOnlyAfterExplicitAction() async {
        let loginItem = FakeLoginItemController()
        let store = makeStore(
            loginItem: loginItem,
            supervisor: FakeRuntimeHostSupervisor()
        )

        await store.refresh()
        let writesAfterRefresh = await loginItem.writes()
        #expect(writesAfterRefresh.isEmpty)

        await store.setRunAtLogin(true)

        let writesAfterAction = await loginItem.writes()
        #expect(writesAfterAction == [true])
        #expect(store.runAtLoginEnabled)
    }

    @Test
    func startupReadsExistingLoginChoiceWithoutWritingOrStartingWork() async {
        let loginItem = FakeLoginItemController(enabled: true)
        let supervisor = FakeRuntimeHostSupervisor()
        let store = makeStore(loginItem: loginItem, supervisor: supervisor)
        await store.refreshLoginPreference()
        #expect(store.runAtLoginEnabled)
        #expect(await loginItem.writes().isEmpty)
        #expect(await supervisor.starts().isEmpty)
    }

    @Test
    func missingCodexAccountDoesNotDiscardRuntimeUsageOrPresence() async {
        let store = RuntimeMenuStore(
            snapshotReader: FakeSnapshotReader(snapshot: .active(activeSnapshot)),
            usageReader: FakeUsageReader(usage: [monthlyUsage(month: "2026-10")]),
            accountReader: UnavailableAccountReader(),
            supervisor: FakeRuntimeHostSupervisor(), loginItem: FakeLoginItemController()
        )
        await store.refresh()
        #expect(store.account == nil)
        #expect(store.monthlyUsage.map(\.month) == ["2026-10"])
        #expect(store.snapshot.activeSnapshot?.owner == .tray)
        #expect(store.errorMessage == nil)
    }

    private func makeStore(
        loginItem: FakeLoginItemController,
        supervisor: FakeRuntimeHostSupervisor
    ) -> RuntimeMenuStore {
        RuntimeMenuStore(
            snapshotReader: FakeSnapshotReader(snapshot: .active(activeSnapshot)),
            usageReader: FakeUsageReader(usage: [
                monthlyUsage(month: "2026-08"),
                monthlyUsage(month: "2025-01"),
            ]),
            accountReader: FakeAccountReader(account: accountSnapshot),
            supervisor: supervisor,
            loginItem: loginItem
        )
    }
}

private struct FakeSnapshotReader: RuntimeSnapshotReading {
    let snapshot: RuntimeHostSnapshot

    func readSnapshot() async -> RuntimeHostSnapshot {
        snapshot
    }
}

private struct FakeUsageReader: RuntimeUsageReading {
    let usage: [MonthlyUsageAggregate]

    func readAllMonthlyAggregates() async -> [MonthlyUsageAggregate] {
        usage
    }
}

private struct FakeAccountReader: RuntimeAccountReading {
    let account: AdapterAccountSnapshot

    func readAccount() async -> AdapterAccountSnapshot {
        account
    }
}

private actor FakeRuntimeHostSupervisor: RuntimeHostSupervising {
    private var capturedStarts: [RuntimeHostOwner] = []
    private var stopCount = 0

    func start(owner: RuntimeHostOwner) {
        capturedStarts.append(owner)
    }

    func stop() {
        stopCount += 1
    }

    func starts() -> [RuntimeHostOwner] {
        capturedStarts
    }
}

private actor FakeLoginItemController: LoginItemControlling {
    private var enabled = false
    private var capturedWrites: [Bool] = []

    init(enabled: Bool = false) { self.enabled = enabled }

    func isEnabled() -> Bool {
        enabled
    }

    func setEnabled(_ enabled: Bool) {
        self.enabled = enabled
        capturedWrites.append(enabled)
    }

    func writes() -> [Bool] {
        capturedWrites
    }
}

private let activeSnapshot = ActiveRuntimeHostSnapshot(
    pid: 404,
    owner: .tray,
    state: .online,
    deviceID: "device-1",
    startedAtMilliseconds: 1_786_752_000_000,
    updatedAtMilliseconds: 1_786_752_001_000,
    activeAttempts: 0,
    queuedEvents: 0,
    lastError: nil
)

private let accountSnapshot = AdapterAccountSnapshot(
    adapter: "codex_app_server",
    account: RuntimeAccountDetails(
        authMethod: .chatGPT,
        identity: "personal@example.test",
        plan: "pro",
        requiresOpenaiAuth: true
    ),
    rateLimitReadError: nil
)

private func monthlyUsage(month: String) -> MonthlyUsageAggregate {
    let known = UsageTokenAggregate(known: 10, unavailableReports: 0)
    return MonthlyUsageAggregate(
        month: month,
        provider: "openai",
        modelID: "gpt-5.6-luna",
        turnReports: 1,
        tokens: MonthlyUsageTokenTotals(
            input: known,
            output: known,
            cachedInput: known,
            reasoning: known,
            total: known
        ),
        costs: [],
        unpricedReports: 1
    )
}

private struct UnavailableAccountReader: RuntimeAccountReading {
    func readAccount() async throws -> AdapterAccountSnapshot { throw CocoaError(.fileNoSuchFile) }
}
