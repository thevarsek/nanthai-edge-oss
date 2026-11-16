import Foundation

public enum RuntimeAppError: LocalizedError {
    case missingPackage
    case commandFailed(String)
    case invalidPairing
    case runtimeOwnedByTerminal
    case connectionRevoked

    public var errorDescription: String? {
        switch self {
        case .missingPackage: "The bundled Runtime Host is missing. Reinstall NanthAI Runtime."
        case .commandFailed(let message): message
        case .invalidPairing: "Paste the complete pairing command from NanthAI Settings → Local runtime."
        case .runtimeOwnedByTerminal: "The Runtime Host is running in a terminal. Stop it there before starting it from the menu bar."
        case .connectionRevoked: "This Mac's NanthAI connection is no longer authorized. Connect your NanthAI account again."
        }
    }
}

public actor RuntimeProcessOperator: RuntimeOperatorOutputReading, RuntimeHostSupervising {
    private let executable: URL
    private let managesCredentials: Bool
    private var migratedCredential = false
    private let vault: any RuntimeCredentialStoring
    private var codexPath: String
    private var piPath: String
    private var piWorkingDirectory: String
    private var host: Process?
    private var hostCredential: Data?
    private var nextRestartAt = Date.distantPast
    private var restartDelay: TimeInterval = 1

    public init(executable: URL, codexPath: String, piPath: String = "", piWorkingDirectory: String = "", managesCredentials: Bool = false, credentialVault: any RuntimeCredentialStoring = RuntimeCredentialVault()) {
        self.vault = credentialVault
        self.managesCredentials = managesCredentials
        self.executable = executable
        self.codexPath = codexPath
        self.piPath = piPath
        self.piWorkingDirectory = piWorkingDirectory
    }

    public func selectCodex(_ path: String) { codexPath = path }
    public func selectPi(_ path: String) { piPath = path }
    public func selectPiWorkingDirectory(_ path: String) { piWorkingDirectory = path }

    public func output(arguments: [String]) async throws -> Data {
        try await execute(arguments: arguments, input: nil)
    }

    public func output(arguments: [String], input: Data) async throws -> Data {
        try await execute(arguments: arguments, input: input)
    }

    private func execute(arguments: [String], input: Data?) async throws -> Data {
        let executable = executable
        var environment = environment()
        var requestInput = input
        if managesCredentials {
            let credential = try vault.read()
            if let credential, !migratedCredential {
                try vault.write(credential) // Preserve existing pairings, replace the legacy security-tool ACL.
                migratedCredential = true
            }
            let object: Any = try credential.map { try JSONSerialization.jsonObject(with: $0) } ?? NSNull()
            requestInput = try JSONSerialization.data(withJSONObject: ["credential": object,
                "input": input.flatMap { String(data: $0, encoding: .utf8) } ?? ""])
            environment["NANTHAI_APP_REQUEST_STDIN"] = "1"
        }
        let transmittedInput = requestInput
        let result = try await Task.detached {
            let process = Process()
            process.executableURL = executable
            process.arguments = arguments
            process.environment = environment
            let stdout = Pipe(), stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            let stdin = Pipe()
            process.standardInput = transmittedInput == nil ? FileHandle.nullDevice : stdin
            try process.run()
            if let transmittedInput {
                try stdin.fileHandleForWriting.write(contentsOf: transmittedInput)
                try stdin.fileHandleForWriting.close()
            }
            async let data = Task.detached { stdout.fileHandleForReading.readDataToEndOfFile() }.value
            async let errors = Task.detached { stderr.fileHandleForReading.readDataToEndOfFile() }.value
            process.waitUntilExit()
            let result = await (data, errors)
            // Probe/account commands emit useful signed-out JSON with exit 2.
            if process.terminationStatus != 0 && !(process.terminationStatus == 2 && arguments.first == "adapters") {
                throw RuntimeAppError.commandFailed(String(data: result.1, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Runtime Host command failed.")
            }
            return result.0
        }.value
        if managesCredentials && arguments.first == "unpair" { try vault.delete() }
        return result
    }

    public func confirmPairing(_ review: RuntimePairingReview) throws {
        try vault.write(JSONEncoder().encode(review))
        migratedCredential = true
    }

    public func start(owner: RuntimeHostOwner) async throws {
        if host?.isRunning == true { return }
        let snapshot = try JSONDecoder().decode(RuntimeHostSnapshot.self, from: await output(arguments: ["runtime", "status"]))
        if let active = snapshot.activeSnapshot {
            if active.owner == .foregroundCLI { throw RuntimeAppError.runtimeOwnedByTerminal }
            return
        }
        if managesCredentials {
            // Persist before finalization. Older servers/offline connections keep the saved pairing.
            do {
                let prepared = try await output(arguments: ["credentials", "prepare-rotation"])
                try vault.write(prepared)
                let finalized = try await output(arguments: ["credentials", "finish-rotation"])
                try vault.write(finalized)
            } catch { FileHandle.standardError.write(Data("NanthAI credential rotation remains pending.\n".utf8)) }
        }
        let credentialInput: Data?
        let currentCredential = try managesCredentials ? vault.read() : nil
        if managesCredentials {
            let object: Any = try currentCredential.map { try JSONSerialization.jsonObject(with: $0) } ?? NSNull()
            credentialInput = try JSONSerialization.data(withJSONObject: ["credential": object])
        } else { credentialInput = nil }
        let process = Process()
        process.executableURL = executable
        process.arguments = ["runtime", "start", "--owner", owner.rawValue]
        process.environment = environment()
        process.environment?["NANTHAI_TRAY_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        // Canonical status/events carry errors. Never write credentials or native content to a tray log.
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        let stdin = Pipe()
        if managesCredentials {
            process.standardInput = stdin
            process.environment?["NANTHAI_APP_REQUEST_STDIN"] = "1"
        }
        try process.run()
        if let credentialInput {
            try stdin.fileHandleForWriting.write(contentsOf: credentialInput)
            try stdin.fileHandleForWriting.close()
        }
        hostCredential = currentCredential
        host = process
    }

    public func restartExitedHost() async throws {
        guard let host, !host.isRunning else { return }
        if host.terminationStatus == 77 {
            self.host = nil
            if managesCredentials, try vault.read() == hostCredential { try vault.delete() }
            restartDelay = 1
            throw RuntimeAppError.connectionRevoked
        }
        guard Date() >= nextRestartAt else { return }
        nextRestartAt = Date().addingTimeInterval(restartDelay)
        restartDelay = min(restartDelay * 2, 30)
        try await start(owner: .tray)
    }

    public func stop() async throws {
        let snapshot = try JSONDecoder().decode(RuntimeHostSnapshot.self, from: await output(arguments: ["runtime", "status"]))
        if snapshot.activeSnapshot?.owner == .foregroundCLI { throw RuntimeAppError.runtimeOwnedByTerminal }
        if !snapshot.canStart { _ = try await output(arguments: ["runtime", "stop", "--wait"]) }
        host = nil
        restartDelay = 1
    }

    private func environment() -> [String: String] {
        var values = ProcessInfo.processInfo.environment
        values["NANTHAI_CODEX_COMMAND"] = codexPath
        values["NANTHAI_PI_COMMAND"] = piPath
        values["NANTHAI_PI_WORKING_DIRECTORY"] = piWorkingDirectory
        return values
    }
}
