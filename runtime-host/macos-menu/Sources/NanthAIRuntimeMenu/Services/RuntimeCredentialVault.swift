import Foundation
import Security
import RuntimeKeychainAccess

public protocol RuntimeCredentialStoring: Sendable {
    func read() throws -> Data?
    func write(_ data: Data) throws
    func delete() throws
}

/// The signed menu app owns credentials; Node receives only an inherited pipe.
public struct RuntimeCredentialVault: RuntimeCredentialStoring {
    private let service = "ai.nanthai.runtime-host"
    private let account = "paired-device"
    public init() {}

    public func read() throws -> Data? {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data else { throw VaultError.invalidData }
        return data
    }

    public func write(_ data: Data) throws { try write(data, trustCurrentApplication: true) }

    public func write(_ data: Data, trustCurrentApplication: Bool) throws {
        // No `security` executable is trusted. The menu app trusts only its own
        // signing identity; CLI writes use an empty trusted-app list.
        try check(NanthAIStoreCredential(data as CFData, trustCurrentApplication))
    }

    public func delete() throws {
        let status = SecItemDelete(identity as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }

    private var identity: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }
    private func check(_ status: OSStatus) throws {
        if status != errSecSuccess { throw VaultError.keychain(status) }
    }
}

private enum VaultError: LocalizedError {
    case invalidData
    case keychain(OSStatus)
    var errorDescription: String? {
        String(localized: "macOS Keychain could not access the NanthAI device credential. Unlock the login Keychain and try again.")
    }
}
