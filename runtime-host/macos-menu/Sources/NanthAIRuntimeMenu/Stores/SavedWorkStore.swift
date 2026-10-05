import Foundation
import Observation

public struct SavedWorkListing: Decodable, Sendable {
    public let tasks: [SavedWorkTask]
}
public struct SavedWorkTask: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let adapter: String
    public let modelId: String?
    public let output: String
    public let updatedAt: Double
    public let outcome: String?
    public let artifacts: [SavedWorkArtifact]?
    public let results: [SavedWorkResult]
    public let requests: [SavedNativeRequest]?
}
public struct SavedWorkResult: Decodable, Identifiable, Sendable {
    public let id: String
    public let prompt: String
    public let output: String
    public let outcome: String?
    public let synced: Bool
    public let disposition: String?
    public let artifacts: [SavedWorkArtifact]?
    public let filenames: [String]
}

public struct SavedWorkArtifact: Decodable, Identifiable, Sendable {
    public let filename: String
    public let path: String
    public var id: String { path }
}

@MainActor @Observable
public final class SavedWorkStore {
    public private(set) var tasks: [SavedWorkTask] = []
    public private(set) var runningTaskIds: Set<String> = []
    public var isRunning: Bool { !runningTaskIds.isEmpty }
    public private(set) var error: String?
    private let commands: any RuntimeOperatorOutputReading

    public init(commands: any RuntimeOperatorOutputReading) { self.commands = commands }
    public func refresh() async {
        do {
            let data = try await commands.output(arguments: ["saved", "list"])
            tasks = try JSONDecoder().decode(SavedWorkListing.self, from: data).tasks
                .sorted { $0.updatedAt > $1.updatedAt }
        } catch { self.error = error.localizedDescription }
    }
    public func continueTask(_ id: String, prompt: String) async {
        guard !runningTaskIds.contains(id) else { return }
        runningTaskIds.insert(id)
        error = nil
        defer { runningTaskIds.remove(id) }
        do { _ = try await commands.output(arguments: ["saved", "continue", id, prompt]) }
        catch { self.error = error.localizedDescription }
        await refresh()
        await synchronize()
    }
    public func nativeControl(_ id: String, payload: [String: Any]) async {
        do {
            let input = try JSONSerialization.data(withJSONObject: payload)
            _ = try await commands.output(arguments: ["saved", "control", id], input: input)
            error = nil
        } catch { self.error = error.localizedDescription }
        await refresh()
    }
    public func synchronize() async {
        do { _ = try await commands.output(arguments: ["saved", "sync"]) }
        catch { self.error = error.localizedDescription }
        await refresh()
    }
}
