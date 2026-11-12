import AppKit
import Testing
@testable import NanthAIRuntimeMenu

@MainActor
struct RuntimeTerminationCoordinatorTests {
    @Test func shutdownCompletesBeforeReissuedTerminationAndCoalescesRequests() async {
        let coordinator = RuntimeTerminationCoordinator()
        let stopResult = AsyncStream<Bool>.makeStream()
        let finished = AsyncStream<Void>.makeStream()
        var stopCount = 0
        var terminateCount = 0
        let stop: @MainActor () async -> Bool = {
            stopCount += 1
            for await result in stopResult.stream { return result }
            return false
        }
        let terminate: @MainActor () -> Void = {
            terminateCount += 1
            // Exercise the delegate's reentrant call from NSApp.terminate.
            #expect(coordinator.requestTermination(stop: stop, terminate: {}) == .terminateNow)
            finished.continuation.yield(())
            finished.continuation.finish()
        }

        #expect(coordinator.requestTermination(stop: stop, terminate: terminate) == .terminateCancel)
        #expect(coordinator.requestTermination(stop: stop, terminate: terminate) == .terminateCancel)
        #expect(terminateCount == 0)
        stopResult.continuation.yield(true)
        stopResult.continuation.finish()
        for await _ in finished.stream { break }
        #expect(stopCount == 1)
        #expect(terminateCount == 1)
    }

    @Test func failedShutdownAllowsRetryWithoutTerminating() async {
        let coordinator = RuntimeTerminationCoordinator()
        let retried = AsyncStream<Void>.makeStream()
        var stopCount = 0
        let stop: @MainActor () async -> Bool = {
            stopCount += 1
            return stopCount > 1
        }

        #expect(coordinator.requestTermination(stop: stop, terminate: {
            Issue.record("Failed shutdown must not terminate the app")
        }) == .terminateCancel)
        // Let the failed cleanup return before retrying the ordinary Quit action.
        while stopCount == 0 { await Task.yield() }
        #expect(coordinator.requestTermination(stop: stop, terminate: {
            retried.continuation.yield(())
            retried.continuation.finish()
        }) == .terminateCancel)
        for await _ in retried.stream { break }
        #expect(stopCount == 2)
    }
}
