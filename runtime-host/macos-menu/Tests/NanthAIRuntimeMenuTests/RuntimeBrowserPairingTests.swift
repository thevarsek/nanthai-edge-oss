import Foundation
import Testing
@testable import NanthAIRuntimeMenu

struct RuntimeBrowserPairingTests {
    @Test func browserReturnBindsStateAndServerAndExpires() throws {
        let web = try #require(URL(string: "http://127.0.0.1:4175"))
        let server = try #require(URL(string: "https://dev.convex.site"))
        let start = Date(timeIntervalSince1970: 1000)
        let pending = try RuntimeBrowserPairing(webOrigin: web, serverOrigin: server,
            computerName: "QA Mac", state: "qa-state", now: start)
        #expect(pending.browserURL.path == "/runtime/connect")
        #expect(URLComponents(url: pending.browserURL, resolvingAgainstBaseURL: false)?.queryItems?.contains(URLQueryItem(name: "computer", value: "QA Mac")) == true)
        let link = try #require(URL(string: "nanthai-runtime://pair?state=qa-state&server=https%3A%2F%2Fdev.convex.site&pairingId=pairing_qa&code=nrp_test"))
        #expect(try pending.claimArguments(from: link, now: start.addingTimeInterval(1)) == ["pair", "pairing_qa", "nrp_test", "--server", server.absoluteString])
        #expect(throws: (any Error).self) { try pending.claimArguments(from: link, now: start.addingTimeInterval(600)) }
        for replacement in ["state=foreign", "state=qa-state&state=foreign", "server=https%3A%2F%2Fforeign.convex.site"] {
            let raw = link.absoluteString.replacingOccurrences(of: replacement.hasPrefix("state") ? "state=qa-state" : "server=https%3A%2F%2Fdev.convex.site", with: replacement)
            let invalid = try #require(URL(string: raw))
            #expect(throws: (any Error).self) { try pending.claimArguments(from: invalid, now: start.addingTimeInterval(1)) }
        }
    }
}
