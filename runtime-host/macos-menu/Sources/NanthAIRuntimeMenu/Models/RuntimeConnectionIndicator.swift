import Foundation

public enum RuntimeIndicatorTone: Equatable, Sendable {
    case ready, attention, problem
}

public struct RuntimeConnectionIndicator: Equatable, Sendable {
    public let tone: RuntimeIndicatorTone
    public let label: String

    public init(snapshot: RuntimeHostSnapshot, readyAdapterCount: Int, hasAdapterIssue: Bool) {
        switch snapshot {
        case .active(let value) where value.state == .online:
            tone = readyAdapterCount > 0 ? (hasAdapterIssue ? .attention : .ready) : .attention
            label = hasAdapterIssue ? "Online · check runtime setup" : "Online"
        case .active(let value) where value.state == .failed:
            tone = .problem
            label = "Runtime error"
        case .active(let value):
            tone = .attention
            label = value.state.displayName
        case .offline:
            tone = hasAdapterIssue && readyAdapterCount == 0 ? .problem : .attention
            label = readyAdapterCount > 0 ? "Offline · ready to start" : "Offline"
        }
    }
}
