import Foundation

public struct RuntimeAdapterReadiness: Decodable, Equatable, Sendable {
    public let healthy: Bool
    public let cliVersion: String
    public let modelCount: Int
    public let account: Account

    public struct Account: Decodable, Equatable, Sendable {
        public let authMethod: String
        public let identity: String?
    }

    public var isReady: Bool { healthy && account.authMethod != "signed_out" && modelCount > 0 }
}
