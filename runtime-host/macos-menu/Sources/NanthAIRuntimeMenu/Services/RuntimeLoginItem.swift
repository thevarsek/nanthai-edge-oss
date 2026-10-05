import Foundation
import ServiceManagement

public struct RuntimeLoginItem: LoginItemControlling {
    public init() {}
    public func isEnabled() async throws -> Bool { SMAppService.mainApp.status == .enabled }
    public func setEnabled(_ enabled: Bool) async throws {
        if enabled { try SMAppService.mainApp.register() }
        else { try await SMAppService.mainApp.unregister() }
        if SMAppService.mainApp.status == .requiresApproval {
            throw RuntimeAppError.commandFailed("Allow NanthAI Runtime in System Settings → General → Login Items, then refresh.")
        }
    }
}
