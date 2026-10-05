import Foundation

public enum RuntimeAuthenticationMethod: String, Decodable, Equatable, Sendable {
    case chatGPT = "chatgpt"
    case apiKey = "api_key"
    case amazonBedrock = "amazon_bedrock"
    case signedOut = "signed_out"

    public var displayName: String {
        switch self {
        case .chatGPT:
            "ChatGPT"
        case .apiKey:
            "API key"
        case .amazonBedrock:
            "Amazon Bedrock"
        case .signedOut:
            "Signed out"
        }
    }
}

public struct RuntimeAccountDetails: Decodable, Equatable, Sendable {
    public let authMethod: RuntimeAuthenticationMethod
    public let identity: String?
    public let plan: String?
    public let requiresOpenaiAuth: Bool

    public init(
        authMethod: RuntimeAuthenticationMethod,
        identity: String?,
        plan: String?,
        requiresOpenaiAuth: Bool
    ) {
        self.authMethod = authMethod
        self.identity = identity
        self.plan = plan
        self.requiresOpenaiAuth = requiresOpenaiAuth
    }
}

public struct AdapterAccountSnapshot: Decodable, Equatable, Sendable {
    public let adapter: String
    public let account: RuntimeAccountDetails
    public let rateLimitReadError: String?
    public let rateLimits: RuntimeAccountRateLimits?

    public init(
        adapter: String,
        account: RuntimeAccountDetails,
        rateLimitReadError: String?,
        rateLimits: RuntimeAccountRateLimits? = nil
    ) {
        self.adapter = adapter
        self.account = account
        self.rateLimitReadError = rateLimitReadError
        self.rateLimits = rateLimits
    }
}

public struct RuntimeAccountRateLimits: Decodable, Equatable, Sendable {
    public let limitName: String?
    public let primary: RuntimeAccountRateWindow?
    public let secondary: RuntimeAccountRateWindow?
}

public struct RuntimeAccountRateWindow: Decodable, Equatable, Sendable {
    public let usedPercent: Double
    public let windowDurationMins: Double?
    public let resetsAt: Double?

    public var chartFraction: Double { min(max(usedPercent / 100, 0), 1) }
}
