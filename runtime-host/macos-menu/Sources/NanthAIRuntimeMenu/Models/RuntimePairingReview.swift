import Foundation

public struct RuntimePairingReview: Codable, Equatable, Sendable {
    public let deviceId: String
    public let credentialId: String
    public let credential: String
    public let controlPlaneUrl: String
    public let accountId: String
    /// Display-only label for the pairing review. Older servers omit it.
    public let accountEmail: String?

    /// The account label people recognise: the email when the server sent one, otherwise the account ID.
    public var accountDisplayName: String { accountEmail ?? accountId }

    public init(data: Data, allowedOrigins: Set<String>) throws {
        let decoded = try JSONDecoder().decode(Self.self, from: data)
        let email = decoded.accountEmail?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.deviceId = decoded.deviceId
        self.credentialId = decoded.credentialId
        self.credential = decoded.credential
        self.controlPlaneUrl = decoded.controlPlaneUrl
        self.accountId = decoded.accountId
        self.accountEmail = email?.isEmpty == false ? email : nil
        guard !accountId.isEmpty, !credential.isEmpty,
              let url = URL(string: controlPlaneUrl),
              RuntimePairingCommand.accepts(url, allowedOrigins: allowedOrigins)
        else { throw RuntimeAppError.invalidPairing }
    }

    /// The encoded form is the stored device credential, which the host parses strictly; the email is not part of it.
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceId, forKey: .deviceId)
        try container.encode(credentialId, forKey: .credentialId)
        try container.encode(credential, forKey: .credential)
        try container.encode(controlPlaneUrl, forKey: .controlPlaneUrl)
        try container.encode(accountId, forKey: .accountId)
    }
}
