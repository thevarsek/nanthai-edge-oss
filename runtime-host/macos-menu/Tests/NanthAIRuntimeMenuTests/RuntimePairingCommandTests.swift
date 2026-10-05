import Testing
@testable import NanthAIRuntimeMenu

struct RuntimePairingCommandTests {
    @Test func acceptsBackendCommandsWithoutShellEvaluation() throws {
        #expect(try RuntimePairingCommand("nanthai pair pairing_qa 123456 --server https://dev.convex.site").arguments == ["pair", "pairing_qa", "123456", "--server", "https://dev.convex.site"])
        #expect(try RuntimePairingCommand("nanthai pair pairing_qa code").arguments.count == 3)
        for invalid in ["nanthai pair pairing_qa $(secret)", "nanthai pair pairing_qa 123 ; exit", "nanthai pair pairing_qa 123 --server https://user:pass@dev.convex.site", "nanthai pair pairing_qa 123 --server https://dev.convex.site?secret=1"] {
            #expect(throws: RuntimeAppError.self) { try RuntimePairingCommand(invalid) }
        }
    }
}
