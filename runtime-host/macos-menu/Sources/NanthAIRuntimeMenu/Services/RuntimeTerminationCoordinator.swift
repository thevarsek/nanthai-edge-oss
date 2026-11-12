import AppKit

@MainActor
public final class RuntimeTerminationCoordinator {
    private var readyToTerminate = false
    private var shutdown: Task<Void, Never>?

    public init() {}

    deinit { shutdown?.cancel() }

    public func requestTermination(
        stop: @escaping @MainActor () async -> Bool,
        terminate: @escaping @MainActor () -> Void
    ) -> NSApplication.TerminateReply {
        if readyToTerminate { return .terminateNow }
        guard shutdown == nil else { return .terminateCancel }

        // terminateLater enters AppKit's modal run loop, which can strand the
        // main-actor cleanup task. Return to the normal loop while it runs,
        // then issue a new termination request after the host has stopped.
        shutdown = Task { [weak self] in
            let stopped = await stop()
            guard !Task.isCancelled, let self else { return }
            self.shutdown = nil
            guard stopped else { return }
            self.readyToTerminate = true
            terminate()
        }
        return .terminateCancel
    }
}
