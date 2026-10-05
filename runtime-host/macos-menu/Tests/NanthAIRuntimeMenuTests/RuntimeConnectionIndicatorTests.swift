import Foundation
import Testing
@testable import NanthAIRuntimeMenu

struct RuntimeConnectionIndicatorTests {
    @Test func indicatorsDistinguishConnectionFromExecutableReadiness() {
        let offline = RuntimeHostSnapshot.offline(OfflineRuntimeHostSnapshot(paired: true, deviceID: "mac"))
        let readyOffline = RuntimeConnectionIndicator(snapshot: offline, readyAdapterCount: 1, hasAdapterIssue: false)
        #expect(readyOffline.tone == .attention)
        #expect(readyOffline.label == "Offline · ready to start")
        #expect(RuntimeConnectionIndicator(snapshot: state(.online), readyAdapterCount: 1, hasAdapterIssue: false).tone == .ready)
        #expect(RuntimeConnectionIndicator(snapshot: state(.online), readyAdapterCount: 1, hasAdapterIssue: true).tone == .attention)
        #expect(RuntimeConnectionIndicator(snapshot: state(.failed), readyAdapterCount: 1, hasAdapterIssue: false).tone == .problem)
        #expect(RuntimeConnectionIndicator(snapshot: offline, readyAdapterCount: 0, hasAdapterIssue: true).tone == .problem)
    }

    private func state(_ state: RuntimeHostLifecycleState) -> RuntimeHostSnapshot {
        .active(ActiveRuntimeHostSnapshot(pid: 10, owner: .tray, state: state, deviceID: "mac",
            startedAtMilliseconds: 1, updatedAtMilliseconds: 2, activeAttempts: 0, queuedEvents: 0, lastError: nil))
    }
}
