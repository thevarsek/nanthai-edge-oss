import Foundation

public protocol RuntimeOperatorOutputReading: Sendable {
    func output(arguments: [String]) async throws -> Data
    func output(arguments: [String], input: Data) async throws -> Data
}

public extension RuntimeOperatorOutputReading {
    func output(arguments: [String], input: Data) async throws -> Data {
        throw RuntimeAppError.commandFailed("This build cannot send native responses.")
    }
}

public protocol RuntimeSnapshotReading: Sendable {
    func readSnapshot() async throws -> RuntimeHostSnapshot
}

public protocol RuntimeUsageReading: Sendable {
    func readAllMonthlyAggregates() async throws -> [MonthlyUsageAggregate]
}

public protocol RuntimeAccountReading: Sendable {
    func readAccount() async throws -> AdapterAccountSnapshot
}

public struct RuntimeSnapshotReader: RuntimeSnapshotReading {
    private let operatorOutput: any RuntimeOperatorOutputReading

    public init(operatorOutput: any RuntimeOperatorOutputReading) {
        self.operatorOutput = operatorOutput
    }

    public func readSnapshot() async throws -> RuntimeHostSnapshot {
        let data = try await operatorOutput.output(arguments: ["runtime", "status"])
        return try JSONDecoder().decode(RuntimeHostSnapshot.self, from: data)
    }
}

public struct RuntimeUsageReader: RuntimeUsageReading {
    private let operatorOutput: any RuntimeOperatorOutputReading

    public init(operatorOutput: any RuntimeOperatorOutputReading) {
        self.operatorOutput = operatorOutput
    }

    public func readAllMonthlyAggregates() async throws -> [MonthlyUsageAggregate] {
        let data = try await operatorOutput.output(arguments: ["usage"])
        return try JSONDecoder().decode([MonthlyUsageAggregate].self, from: data)
    }
}

public struct RuntimeAccountReader: RuntimeAccountReading {
    private let operatorOutput: any RuntimeOperatorOutputReading

    public init(operatorOutput: any RuntimeOperatorOutputReading) {
        self.operatorOutput = operatorOutput
    }

    public func readAccount() async throws -> AdapterAccountSnapshot {
        let data = try await operatorOutput.output(
            arguments: ["adapters", "account", "codex"]
        )
        return try JSONDecoder().decode(AdapterAccountSnapshot.self, from: data)
    }
}
