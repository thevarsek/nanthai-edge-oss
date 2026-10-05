import Foundation
import Testing
@testable import NanthAIRuntimeMenu

@Suite("Runtime operator readers")
struct RuntimeOperatorReadersTests {
    @Test
    func decodesCurrentCLIContractsAndRequestsAllMonths() async throws {
        let output = FakeRuntimeOperatorOutput(outputs: [
            ["runtime", "status"]: Data(activeSnapshotJSON.utf8),
            ["usage"]: Data(usageJSON.utf8),
            ["adapters", "account", "codex"]: Data(accountJSON.utf8),
        ])

        let snapshot = try await RuntimeSnapshotReader(operatorOutput: output).readSnapshot()
        let usage = try await RuntimeUsageReader(operatorOutput: output)
            .readAllMonthlyAggregates()
        let account = try await RuntimeAccountReader(operatorOutput: output).readAccount()

        #expect(snapshot.activeSnapshot?.owner == .tray)
        #expect(snapshot.activeSnapshot?.activeAttempts == 2)
        #expect(usage.map(\.month) == ["2026-08", "2025-01"])
        #expect(usage[0].costs[0].source == .providerReported)
        #expect(account.account.identity == "personal@example.test")
        #expect(account.account.authMethod == .chatGPT)
        let requests = await output.requests()
        #expect(requests.contains(["usage"]))
        #expect(!requests.contains(where: { $0.first == "usage" && $0.count > 1 }))
        #expect(RuntimeUsageCopy.monthlyAggregateTitle == "Monthly aggregate")
    }

    @Test
    func decodesOfflineSnapshotWithoutInventingAnOwner() async throws {
        let output = FakeRuntimeOperatorOutput(outputs: [
            ["runtime", "status"]: Data(
                #"{"state":"offline","paired":true,"deviceId":"device-1"}"#.utf8
            ),
        ])
        let snapshot = try await RuntimeSnapshotReader(operatorOutput: output).readSnapshot()

        #expect(snapshot == .offline(
            OfflineRuntimeHostSnapshot(paired: true, deviceID: "device-1")
        ))
        #expect(snapshot.activeSnapshot == nil)
    }
}

private actor FakeRuntimeOperatorOutput: RuntimeOperatorOutputReading {
    private let outputs: [[String]: Data]
    private var capturedRequests: [[String]] = []

    init(outputs: [[String]: Data]) {
        self.outputs = outputs
    }

    func output(arguments: [String]) throws -> Data {
        capturedRequests.append(arguments)
        guard let output = outputs[arguments] else {
            throw FakeOutputError.missing(arguments)
        }
        return output
    }

    func requests() -> [[String]] {
        capturedRequests
    }
}

private enum FakeOutputError: Error {
    case missing([String])
}

private let activeSnapshotJSON = #"""
{
  "pid": 404,
  "owner": "tray",
  "state": "online",
  "deviceId": "device-1",
  "startedAtMs": 1786752000000,
  "updatedAtMs": 1786752001000,
  "activeAttempts": 2,
  "queuedEvents": 1,
  "lastError": null
}
"""#

private let usageJSON = #"""
[
  {
    "month": "2026-08",
    "provider": "openai",
    "modelId": "gpt-5.6-luna",
    "turnReports": 2,
    "tokens": {
      "input": { "known": 20, "unavailableReports": 0 },
      "output": { "known": 4, "unavailableReports": 0 },
      "cachedInput": { "known": 0, "unavailableReports": 2 },
      "reasoning": { "known": 2, "unavailableReports": 0 },
      "total": { "known": 24, "unavailableReports": 0 }
    },
    "costs": [
      {
        "source": "provider_reported",
        "currency": "USD",
        "pricingVersion": null,
        "amount": 1.25
      }
    ],
    "unpricedReports": 1
  },
  {
    "month": "2025-01",
    "provider": "openai",
    "modelId": "gpt-5.4",
    "turnReports": 1,
    "tokens": {
      "input": { "known": 3, "unavailableReports": 0 },
      "output": { "known": 0, "unavailableReports": 0 },
      "cachedInput": { "known": 0, "unavailableReports": 1 },
      "reasoning": { "known": 0, "unavailableReports": 1 },
      "total": { "known": 3, "unavailableReports": 0 }
    },
    "costs": [],
    "unpricedReports": 1
  }
]
"""#

private let accountJSON = #"""
{
  "adapter": "codex_app_server",
  "account": {
    "authMethod": "chatgpt",
    "identity": "personal@example.test",
    "plan": "pro",
    "requiresOpenaiAuth": true
  },
  "rateLimits": null,
  "rateLimitReadError": null
}
"""#
