import AppKit
import Foundation
import NanthAIRuntimeMenu
import Observation

@MainActor
@Observable
final class RuntimeAppModel {
    static let shared = RuntimeAppModel()
    let menu: RuntimeMenuStore
    let operatorProcess: RuntimeProcessOperator
    var codexPath: String
    var piPath: String
    var piWorkingDirectory: String
    var codexReady = false
    var piReady = false
    var piVersion: String?
    var piModelCount: Int?
    var codexReadinessError: String?
    var piReadinessError: String?
    private var configurationChanged = false
    var pairingCommand = ""
    var pairingCode = ""
    var connectionPending = false
    private var browserPairing: RuntimeBrowserPairing?
    var isPaired = false
    var isReady = false
    var cliVersion: String?
    var identity: String?
    var busy = false
    var error: String?
    private var monitor: Task<Void, Never>?

    let savedWork: SavedWorkStore

    init() {
        let selected = UserDefaults.standard.string(forKey: "selectedCodexPath") ?? ""
        let selectedPi = UserDefaults.standard.string(forKey: "selectedPiPath") ?? ""
        let directory = UserDefaults.standard.string(forKey: "piWorkingDirectory") ?? ""
        codexPath = selected
        piPath = selectedPi
        piWorkingDirectory = directory
        let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/host/nanthai")
        let process = RuntimeProcessOperator(executable: executable, codexPath: selected, piPath: selectedPi, piWorkingDirectory: directory)
        operatorProcess = process
        savedWork = SavedWorkStore(commands: process)
        menu = RuntimeMenuStore(
            snapshotReader: RuntimeSnapshotReader(operatorOutput: process),
            usageReader: RuntimeUsageReader(operatorOutput: process),
            accountReader: RuntimeAccountReader(operatorOutput: process),
            supervisor: process, loginItem: RuntimeLoginItem()
        )
    }

    func launch() async {
        await menu.refreshLoginPreference()
        await refreshReadiness()
        if isPaired && isReady { await menu.startRuntime() }
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled, let self else { return }
                await menu.refreshSnapshot()
                if configurationChanged, menu.snapshot.activeSnapshot?.activeAttempts == 0 {
                    await menu.stopRuntime()
                    configurationChanged = false
                    if isReady && isPaired { await menu.startRuntime() }
                }
                do { try await operatorProcess.restartExitedHost() }
                catch { self.error = error.localizedDescription }
            }
        }
    }

    var connectionIndicator: RuntimeConnectionIndicator {
        RuntimeConnectionIndicator(snapshot: menu.snapshot, readyAdapterCount: [codexReady, piReady].filter { $0 }.count,
                                   hasAdapterIssue: codexReadinessError != nil || piReadinessError != nil || menu.errorMessage != nil)
    }

    func refreshReadiness() async {
        error = nil
        codexReadinessError = nil
        piReadinessError = nil
        do {
            let data = try await operatorProcess.output(arguments: ["runtime", "status"])
            let snapshot = try JSONDecoder().decode(RuntimeHostSnapshot.self, from: data)
            switch snapshot {
            case .offline(let value): isPaired = value.paired
            case .active: isPaired = true
            }
            if !codexPath.isEmpty {
                let probe = await readReadiness("codex")
                codexReady = probe?.isReady == true
                cliVersion = probe?.cliVersion
                identity = probe?.account.identity ?? probe?.account.authMethod
            } else { codexReady = false; cliVersion = nil; identity = nil }
            if !piPath.isEmpty {
                let probe = await readReadiness("pi")
                piReady = probe?.isReady == true
                piVersion = probe?.cliVersion
                piModelCount = probe?.modelCount
            } else { piReady = false; piVersion = nil; piModelCount = nil }
            isReady = codexReady || piReady
        } catch { isReady = false; self.error = error.localizedDescription }
        await menu.refreshSnapshot()
    }

    private func readReadiness(_ name: String) async -> RuntimeAdapterReadiness? {
        do {
            return try JSONDecoder().decode(RuntimeAdapterReadiness.self,
                from: await operatorProcess.output(arguments: ["adapters", "probe", name]))
        } catch {
            if name == "codex" { codexReadinessError = error.localizedDescription }
            else { piReadinessError = error.localizedDescription }
            return nil
        }
    }

    func selectCodex(_ url: URL) async {
        let path = url.path
        codexPath = path
        UserDefaults.standard.set(path, forKey: "selectedCodexPath")
        await operatorProcess.selectCodex(path)
        configurationChanged = menu.snapshot.activeSnapshot != nil
        await refreshReadiness()
        if isReady && isPaired { await menu.startRuntime() }
    }

    func selectPi(_ url: URL) async {
        piPath = url.path
        UserDefaults.standard.set(piPath, forKey: "selectedPiPath")
        await operatorProcess.selectPi(piPath)
        configurationChanged = menu.snapshot.activeSnapshot != nil
        await refreshReadiness()
        if isReady && isPaired { await menu.startRuntime() }
    }

    func selectPiDirectory(_ url: URL) async {
        piWorkingDirectory = url.path
        UserDefaults.standard.set(piWorkingDirectory, forKey: "piWorkingDirectory")
        await operatorProcess.selectPiWorkingDirectory(piWorkingDirectory)
        configurationChanged = menu.snapshot.activeSnapshot != nil
        await refreshReadiness()
    }

    func pair() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let arguments = pairingCode.isEmpty ? try RuntimePairingCommand(pairingCommand).arguments
                : ["pair-code", pairingCode, "--server", try pairingServer().absoluteString]
            _ = try await operatorProcess.output(arguments: arguments)
            pairingCommand = ""
            pairingCode = ""
            await refreshReadiness()
            if isReady && isPaired { await menu.startRuntime() }
        } catch { self.error = error.localizedDescription }
    }

    func disconnectAccount() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            await menu.stopRuntime()
            _ = try await operatorProcess.output(arguments: ["unpair"])
            await refreshReadiness()
        } catch { self.error = error.localizedDescription }
    }

    private func pairingServer() throws -> URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "NanthAIControlPlaneURL") as? String,
              let url = URL(string: value) else { throw RuntimeAppError.invalidPairing }
        return url
    }

    func connectAccount() {
        do {
            guard let value = Bundle.main.object(forInfoDictionaryKey: "NanthAIWebURL") as? String,
                  let web = URL(string: value) else { throw RuntimeAppError.invalidPairing }
            let pending = try RuntimeBrowserPairing(webOrigin: web, serverOrigin: pairingServer(),
                computerName: Host.current().localizedName ?? "This Mac")
            guard NSWorkspace.shared.open(pending.browserURL) else { throw RuntimeAppError.invalidPairing }
            browserPairing = pending
            connectionPending = true
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func finishAccountConnection(_ url: URL) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            guard let pending = browserPairing else { throw RuntimeAppError.invalidPairing }
            let arguments = try pending.claimArguments(from: url)
            _ = try await operatorProcess.output(arguments: arguments)
            browserPairing = nil
            connectionPending = false
            await refreshReadiness()
            if isReady && isPaired { await menu.startRuntime() }
        } catch { self.error = error.localizedDescription }
    }

    func quit() async {
        NSApp.terminate(nil)
    }

    func stopBeforeQuit() async -> Bool {
        monitor?.cancel()
        do {
            if menu.snapshot.activeSnapshot?.owner != .foregroundCLI { try await operatorProcess.stop() }
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}
