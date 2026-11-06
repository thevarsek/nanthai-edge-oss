import Foundation
import Testing
@testable import NanthAIRuntimeMenu

struct RuntimeProcessOperatorTests {
    @Test func revokedPairingStopsAutomaticRestartsButCrashesRemainRestartable() async throws {
        for exitCode in [77, 1] {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: folder) }
            let executable = folder.appendingPathComponent("host")
            let starts = folder.appendingPathComponent("starts")
            try """
            #!/bin/sh
            if [ "$1 $2" = "runtime status" ]; then
              printf '%s\\n' '{"state":"offline","paired":true}'
              exit 0
            fi
            echo start >> "\(starts.path)"
            exit \(exitCode)
            """.write(to: executable, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
            let process = RuntimeProcessOperator(executable: executable, codexPath: "")
            try await process.start(owner: .tray)
            var rejected = false
            var startCount = 0
            for _ in 0..<100 {
                try await Task.sleep(for: .milliseconds(10))
                do { try await process.restartExitedHost() }
                catch RuntimeAppError.connectionRevoked { rejected = true }
                let contents = (try? String(contentsOf: starts, encoding: .utf8)) ?? ""
                startCount = contents.split(separator: "\n").count
                if rejected || startCount > 1 { break }
            }
            if exitCode == 77 {
                #expect(rejected)
                #expect(startCount == 1)
                try await process.restartExitedHost()
                try await process.restartExitedHost()
                #expect(try String(contentsOf: starts, encoding: .utf8).split(separator: "\n").count == 1)
            } else {
                #expect(!rejected)
                #expect(startCount == 2)
            }
            try await process.stop()
        }
    }

    @Test func stoppingAnAlreadyOfflineHostIsIdempotent() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("offline-host")
        try #"""
        #!/bin/sh
        if [ "$1 $2" = "runtime status" ]; then
          printf '%s\n' '{"state":"offline","paired":false}'
          exit 0
        fi
        echo 'No running host to stop' >&2
        exit 1
        """#.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let process = RuntimeProcessOperator(executable: executable, codexPath: "")
        try await process.stop()
        try await process.stop()
    }
}

extension RuntimeProcessOperatorTests {
    @Test func nativeResponseUsesStdinAndNeverCommandArguments() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("input-host")
        try #"""
        #!/bin/sh
        if [ "$#" != 3 ] || [ "$1 $2 $3" != "saved control run-1" ]; then exit 1; fi
        cat
        """#.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let process = RuntimeProcessOperator(executable: executable, codexPath: "")
        let input = Data(#"{"action":"input","content":{"password":"private-response"}}"#.utf8)
        let output = try await process.output(arguments: ["saved", "control", "run-1"], input: input)
        #expect(output == input)
    }
}
