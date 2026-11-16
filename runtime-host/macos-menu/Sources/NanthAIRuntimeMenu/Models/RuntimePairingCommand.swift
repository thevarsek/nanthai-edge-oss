import Foundation

public struct RuntimePairingCommand: Equatable, Sendable {
    public let arguments: [String]

    /// `allowedOrigins` is the configured pairing server; there is no built-in default.
    public init(_ command: String, allowedOrigins: Set<String>) throws {
        let words = command.split(whereSeparator: \.isWhitespace).map(String.init)
        guard words.count == 4 || words.count == 6,
              words[0] == "nanthai", words[1] == "pair",
              words[2].hasPrefix("pairing_"),
              words[2].allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }),
              words[3].allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
        else { throw RuntimeAppError.invalidPairing }
        if words.count == 6 {
            guard words[4] == "--server", let url = URL(string: words[5]),
                  Self.accepts(url, allowedOrigins: allowedOrigins)
            else { throw RuntimeAppError.invalidPairing }
        }
        arguments = Array(words.dropFirst())
    }

    public static func normalizedOrigin(_ url: URL) -> String? {
        guard url.scheme?.lowercased() == "https", let host = url.host, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/"
        else { return nil }
        let port = url.port.flatMap { $0 == 443 ? nil : ":\($0)" } ?? ""
        return "https://\(host.lowercased())\(port)"
    }

    public static func accepts(_ url: URL, allowedOrigins: Set<String>) -> Bool {
        guard let origin = normalizedOrigin(url) else { return false }
        return allowedOrigins.contains { value in
            URL(string: value).flatMap(Self.normalizedOrigin) == origin
        }
    }
}
