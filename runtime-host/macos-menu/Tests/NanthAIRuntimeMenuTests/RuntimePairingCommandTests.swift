import Testing
@testable import NanthAIRuntimeMenu

struct RuntimePairingCommandTests {
    private let allowed: Set<String> = ["https://example-deployment.convex.site"]

    @Test func acceptsBackendCommandsWithoutShellEvaluation() throws {
        #expect(try RuntimePairingCommand("nanthai pair pairing_qa 123456 --server https://example-deployment.convex.site", allowedOrigins: allowed).arguments == ["pair", "pairing_qa", "123456", "--server", "https://example-deployment.convex.site"])
        #expect(try RuntimePairingCommand("nanthai pair pairing_qa code", allowedOrigins: allowed).arguments.count == 3)
        #expect(try RuntimePairingCommand("nanthai pair pairing_qa code --server https://example-deployment.convex.site:443/",
            allowedOrigins: ["https://example-deployment.convex.site/"]).arguments.count == 5)
        for invalid in ["nanthai pair pairing_qa code --server https://attacker.example", "nanthai pair pairing_qa code --server http://example-deployment.convex.site", "nanthai pair pairing_qa code --server http://localhost:3210", "nanthai pair pairing_qa $(secret)", "nanthai pair pairing_qa 123 ; exit", "nanthai pair pairing_qa 123 --server https://user:pass@dev.convex.site", "nanthai pair pairing_qa 123 --server https://example-deployment.convex.site?secret=1"] {
            #expect(throws: RuntimeAppError.self) { try RuntimePairingCommand(invalid, allowedOrigins: allowed) }
        }
    }

    @Test func rejectsAnyServerWhenNoOriginIsConfigured() {
        #expect(throws: RuntimeAppError.self) {
            try RuntimePairingCommand("nanthai pair pairing_qa code --server https://example-deployment.convex.site", allowedOrigins: [])
        }
    }
}
