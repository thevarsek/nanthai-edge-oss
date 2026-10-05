import Foundation

public enum RuntimeUsageCopy {
    public static let monthlyAggregateTitle = "Monthly aggregate"
}

public struct UsageTokenAggregate: Decodable, Equatable, Sendable {
    public let known: Int
    public let unavailableReports: Int

    public init(known: Int, unavailableReports: Int) {
        self.known = known
        self.unavailableReports = unavailableReports
    }
}

public extension UsageTokenAggregate {
    var displayValue: String {
        unavailableReports == 0 ? known.formatted() : "\(known.formatted()) reported (\(unavailableReports.formatted()) unreported)"
    }
}

public struct MonthlyUsageTokenTotals: Decodable, Equatable, Sendable {
    public let input: UsageTokenAggregate
    public let output: UsageTokenAggregate
    public let cachedInput: UsageTokenAggregate
    public let reasoning: UsageTokenAggregate
    public let total: UsageTokenAggregate

    public init(
        input: UsageTokenAggregate,
        output: UsageTokenAggregate,
        cachedInput: UsageTokenAggregate,
        reasoning: UsageTokenAggregate,
        total: UsageTokenAggregate
    ) {
        self.input = input
        self.output = output
        self.cachedInput = cachedInput
        self.reasoning = reasoning
        self.total = total
    }
}

public enum UsageCostSource: String, Decodable, Equatable, Sendable {
    case providerReported = "provider_reported"
    case apiEquivalentEstimate = "api_equivalent_estimate"

    public var displayName: String {
        switch self {
        case .providerReported:
            "Provider reported"
        case .apiEquivalentEstimate:
            "API-equivalent estimate"
        }
    }
}

public struct MonthlyUsageCost: Decodable, Equatable, Sendable {
    public let source: UsageCostSource
    public let currency: String
    public let pricingVersion: String?
    public let amount: Double

    public init(
        source: UsageCostSource,
        currency: String,
        pricingVersion: String?,
        amount: Double
    ) {
        self.source = source
        self.currency = currency
        self.pricingVersion = pricingVersion
        self.amount = amount
    }
}

public struct MonthlyUsageAggregate: Decodable, Equatable, Identifiable, Sendable {
    public let month: String
    public let provider: String?
    public let modelID: String?
    public let turnReports: Int
    public let tokens: MonthlyUsageTokenTotals
    public let costs: [MonthlyUsageCost]
    public let unpricedReports: Int

    public init(
        month: String,
        provider: String?,
        modelID: String?,
        turnReports: Int,
        tokens: MonthlyUsageTokenTotals,
        costs: [MonthlyUsageCost],
        unpricedReports: Int
    ) {
        self.month = month
        self.provider = provider
        self.modelID = modelID
        self.turnReports = turnReports
        self.tokens = tokens
        self.costs = costs
        self.unpricedReports = unpricedReports
    }

    public var id: String {
        [month, provider ?? "unknown-provider", modelID ?? "unknown-model"]
            .joined(separator: ":")
    }

    private enum CodingKeys: String, CodingKey {
        case month
        case provider
        case modelID = "modelId"
        case turnReports
        case tokens
        case costs
        case unpricedReports
    }
}
