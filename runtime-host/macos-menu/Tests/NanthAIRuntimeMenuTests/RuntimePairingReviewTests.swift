import Foundation
import Testing
@testable import NanthAIRuntimeMenu

struct RuntimePairingReviewTests {
    private let origin = "https://example-deployment.convex.site"

    @Test func requiresServerAccountIdentityAndAnAllowlistedOrigin() throws {
        let payload: [String: String] = ["deviceId": "device", "credentialId": "credential", "credential": "private-token",
            "controlPlaneUrl": origin, "accountId": "user_account"]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let review = try RuntimePairingReview(data: data, allowedOrigins: [origin])
        #expect(review.accountId == "user_account")
        #expect(review.accountEmail == nil)
        #expect(review.accountDisplayName == "user_account")
        #expect(review.controlPlaneUrl == origin)
        #expect(throws: (any Error).self) { try RuntimePairingReview(data: data, allowedOrigins: ["https://elsewhere.test"]) }
        var missing = payload
        missing.removeValue(forKey: "accountId")
        let missingData = try JSONSerialization.data(withJSONObject: missing)
        #expect(throws: (any Error).self) { try RuntimePairingReview(data: missingData, allowedOrigins: [origin]) }
    }

    @Test func showsAccountEmailWithoutStoringItInTheCredential() throws {
        let payload: [String: String] = ["deviceId": "device", "credentialId": "credential", "credential": "private-token",
            "controlPlaneUrl": origin, "accountId": "user_account", "accountEmail": "owner@example.test"]
        let review = try RuntimePairingReview(data: JSONSerialization.data(withJSONObject: payload), allowedOrigins: [origin])
        #expect(review.accountEmail == "owner@example.test")
        #expect(review.accountDisplayName == "owner@example.test")
        #expect(review.accountId == "user_account")
        let stored = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(review)) as? [String: String])
        #expect(stored["accountEmail"] == nil)
        #expect(stored["accountId"] == "user_account")
        var blank = payload
        blank["accountEmail"] = "  "
        let blankReview = try RuntimePairingReview(data: JSONSerialization.data(withJSONObject: blank), allowedOrigins: [origin])
        #expect(blankReview.accountDisplayName == "user_account")
    }

    @Test func appCredentialsAndPairingCodesTravelOnlyThroughStdin() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("host")
        try #"""
        #!/bin/sh
        if [ "$#" != 1 ] || [ "$1" != "pair-prepare" ]; then exit 1; fi
        if [ "$NANTHAI_APP_REQUEST_STDIN" != 1 ]; then exit 1; fi
        cat
        """#.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let credential = Data(#"{"credential":"private-token"}"#.utf8)
        let process = RuntimeProcessOperator(executable: executable, codexPath: "", managesCredentials: true,
            credentialVault: FixtureVault(data: credential))
        let pairing = Data(#"["pair-code","private-pairing-code"]"#.utf8)
        let response = try await process.output(arguments: ["pair-prepare"], input: pairing)
        let envelope = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
        #expect((envelope["credential"] as? [String: String])?["credential"] == "private-token")
        #expect(envelope["input"] as? String == String(data: pairing, encoding: .utf8))
    }
}

private struct FixtureVault: RuntimeCredentialStoring {
    let data: Data
    func read() -> Data? { data }
    func write(_ data: Data) {}
    func delete() {}
}
