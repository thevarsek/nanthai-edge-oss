import Foundation

public enum RuntimeHostOwner: String, Decodable, Equatable, Sendable {
    case foregroundCLI = "foreground_cli"
    case tray

    public var displayName: String {
        switch self {
        case .foregroundCLI:
            "Terminal"
        case .tray:
            "Menu bar"
        }
    }
}

public enum RuntimeHostLifecycleState: String, Decodable, Equatable, Sendable {
    case starting
    case online
    case stopping
    case failed

    public var displayName: String {
        rawValue.capitalized
    }
}

public struct ActiveRuntimeHostSnapshot: Decodable, Equatable, Sendable {
    public let pid: Int
    public let owner: RuntimeHostOwner
    public let state: RuntimeHostLifecycleState
    public let deviceID: String
    public let startedAtMilliseconds: Int64
    public let updatedAtMilliseconds: Int64
    public let activeAttempts: Int
    public let queuedEvents: Int
    public let lastError: String?

    public init(
        pid: Int,
        owner: RuntimeHostOwner,
        state: RuntimeHostLifecycleState,
        deviceID: String,
        startedAtMilliseconds: Int64,
        updatedAtMilliseconds: Int64,
        activeAttempts: Int,
        queuedEvents: Int,
        lastError: String?
    ) {
        self.pid = pid
        self.owner = owner
        self.state = state
        self.deviceID = deviceID
        self.startedAtMilliseconds = startedAtMilliseconds
        self.updatedAtMilliseconds = updatedAtMilliseconds
        self.activeAttempts = activeAttempts
        self.queuedEvents = queuedEvents
        self.lastError = lastError
    }

    public var startedAt: Date {
        Date(timeIntervalSince1970: Double(startedAtMilliseconds) / 1_000)
    }

    public var updatedAt: Date {
        Date(timeIntervalSince1970: Double(updatedAtMilliseconds) / 1_000)
    }

    private enum CodingKeys: String, CodingKey {
        case pid
        case owner
        case state
        case deviceID = "deviceId"
        case startedAtMilliseconds = "startedAtMs"
        case updatedAtMilliseconds = "updatedAtMs"
        case activeAttempts
        case queuedEvents
        case lastError
    }
}

public struct OfflineRuntimeHostSnapshot: Decodable, Equatable, Sendable {
    public let paired: Bool
    public let deviceID: String?

    public init(paired: Bool, deviceID: String?) {
        self.paired = paired
        self.deviceID = deviceID
    }

    private enum CodingKeys: String, CodingKey {
        case paired
        case deviceID = "deviceId"
    }
}

public enum RuntimeHostSnapshot: Decodable, Equatable, Sendable {
    case offline(OfflineRuntimeHostSnapshot)
    case active(ActiveRuntimeHostSnapshot)

    public init(from decoder: Decoder) throws {
        let state = try decoder.container(keyedBy: StateCodingKey.self)
            .decode(String.self, forKey: .state)
        if state == "offline" {
            self = .offline(try OfflineRuntimeHostSnapshot(from: decoder))
        } else {
            self = .active(try ActiveRuntimeHostSnapshot(from: decoder))
        }
    }

    public var displayState: String {
        switch self {
        case .offline:
            "Offline"
        case .active(let snapshot):
            snapshot.state.displayName
        }
    }

    public var systemImage: String {
        switch self {
        case .offline:
            "circle"
        case .active(let snapshot):
            switch snapshot.state {
            case .starting, .stopping:
                "circle.dotted"
            case .online:
                "checkmark.circle.fill"
            case .failed:
                "exclamationmark.triangle.fill"
            }
        }
    }

    public var canStart: Bool {
        if case .offline = self { return true }
        return false
    }

    public var canStop: Bool {
        !canStart
    }

    public var activeSnapshot: ActiveRuntimeHostSnapshot? {
        if case .active(let snapshot) = self { return snapshot }
        return nil
    }

    private enum StateCodingKey: String, CodingKey {
        case state
    }
}
