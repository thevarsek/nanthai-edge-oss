import Foundation
import Testing
@testable import NanthAIRuntimeMenu

struct RuntimeAccountUsageTests {
    @Test
    func piReadinessRequiresConfiguredAuthenticationAndAnInstalledModel() throws {
        for (auth, count, expected) in [("configured", 1, true), ("configured", 0, false), ("signed_out", 1, false)] {
            let data = Data("{\"healthy\":true,\"cliVersion\":\"1.0.0\",\"modelCount\":\(count),\"account\":{\"authMethod\":\"\(auth)\"}}".utf8)
            #expect(try JSONDecoder().decode(RuntimeAdapterReadiness.self, from: data).isReady == expected)
        }
    }

    @Test func missingTokenComponentsAreNotPresentedAsKnownZero() {
        #expect(UsageTokenAggregate(known: 0, unavailableReports: 0).displayValue == "0")
        #expect(UsageTokenAggregate(known: 0, unavailableReports: 2).displayValue.contains("2 unreported"))
    }

    @Test func decodesOptionalLiveCodexWindowsAndKeepsUnknownSeparateFromZero() throws {
        let prefix = #"""
        {"adapter":"codex_app_server","account":{"authMethod":"chatgpt","identity":null,"plan":"pro","requiresOpenaiAuth":true},"rateLimitReadError":null
        """#
        let legacy = try JSONDecoder().decode(AdapterAccountSnapshot.self, from: Data((prefix + "}").utf8))
        #expect(legacy.rateLimits == nil)
        let current = try JSONDecoder().decode(AdapterAccountSnapshot.self, from: Data((prefix + #"""
        ,"rateLimits":{"limitName":"Codex","primary":{"usedPercent":38.0,"windowDurationMins":300.0,"resetsAt":1790900000.0},"secondary":null,"futureField":"ignored"}}
        """#).utf8))
        #expect(current.rateLimits?.primary?.chartFraction == 0.38)
        #expect(current.rateLimits?.primary?.windowDurationMins == 300)
        #expect(current.rateLimits?.secondary == nil)
        let zero = try JSONDecoder().decode(RuntimeAccountRateWindow.self, from: Data(#"{"usedPercent":0.0,"windowDurationMins":null,"resetsAt":null}"#.utf8))
        #expect(zero.chartFraction == 0)
    }
}
