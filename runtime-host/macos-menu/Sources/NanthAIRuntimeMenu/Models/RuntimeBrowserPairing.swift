import Foundation

public struct RuntimeBrowserPairing: Sendable {
    public let state: String
    public let serverOrigin: URL
    public let browserURL: URL
    private let createdAt: Date

    public init(webOrigin: URL, serverOrigin: URL, computerName: String,
                state: String = UUID().uuidString, now: Date = .now) throws {
        guard Self.isOrigin(webOrigin), Self.isOrigin(serverOrigin),
              var url = URLComponents(url: webOrigin, resolvingAgainstBaseURL: false),
              let origin = RuntimePairingCommand.normalizedOrigin(serverOrigin),
              let normalizedServer = URL(string: origin)
        else { throw RuntimeAppError.invalidPairing }
        self.state = state
        self.serverOrigin = normalizedServer
        self.createdAt = now
        url.path = "/runtime/connect"
        url.queryItems = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "computer", value: computerName)]
        guard let browserURL = url.url else { throw RuntimeAppError.invalidPairing }
        self.browserURL = browserURL
    }

    private static func isOrigin(_ url: URL) -> Bool {
        guard let scheme = url.scheme, (scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? ""))), url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
        return url.path.isEmpty || url.path == "/"
    }

    public func claimArguments(from url: URL, now: Date = .now) throws -> [String] {
        guard now.timeIntervalSince(createdAt) < 600, url.scheme == "nanthai-runtime", url.host == "pair",
              url.user == nil, url.password == nil, url.fragment == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              Set(items.map(\.name)).count == items.count,
              items.first(where: { $0.name == "state" })?.value == state,
              items.first(where: { $0.name == "server" })?.value == serverOrigin.absoluteString,
              let pairingID = items.first(where: { $0.name == "pairingId" })?.value,
              let code = items.first(where: { $0.name == "code" })?.value
        else { throw RuntimeAppError.invalidPairing }
        return try RuntimePairingCommand("nanthai pair \(pairingID) \(code) --server \(serverOrigin.absoluteString)", allowedOrigins: [serverOrigin.absoluteString]).arguments
    }
}
