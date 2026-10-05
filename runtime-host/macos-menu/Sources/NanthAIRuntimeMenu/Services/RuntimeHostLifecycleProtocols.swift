import Foundation

public protocol RuntimeHostSupervising: Sendable {
    func start(owner: RuntimeHostOwner) async throws
    func stop() async throws
}

public protocol LoginItemControlling: Sendable {
    func isEnabled() async throws -> Bool
    func setEnabled(_ enabled: Bool) async throws
}
