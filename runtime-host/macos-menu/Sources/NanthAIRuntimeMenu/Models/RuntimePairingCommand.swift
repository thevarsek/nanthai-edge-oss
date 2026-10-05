import Foundation

public struct RuntimePairingCommand: Equatable, Sendable {
    public let arguments: [String]

    public init(_ command: String) throws {
        let words = command.split(whereSeparator: \.isWhitespace).map(String.init)
        guard words.count == 4 || words.count == 6,
              words[0] == "nanthai", words[1] == "pair",
              words[2].hasPrefix("pairing_"),
              words[2].allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }),
              words[3].allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
        else { throw RuntimeAppError.invalidPairing }
        if words.count == 6 {
            guard words[4] == "--server", let url = URL(string: words[5]),
                  ["https", "http"].contains(url.scheme), url.host != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/"
            else { throw RuntimeAppError.invalidPairing }
        }
        arguments = Array(words.dropFirst())
    }
}
