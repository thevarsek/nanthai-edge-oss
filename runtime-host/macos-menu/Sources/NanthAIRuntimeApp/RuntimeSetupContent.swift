import AppKit
import NanthAIRuntimeMenu
import SwiftUI

struct RuntimeSetupContent: View {
    @Bindable var model: RuntimeAppModel

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("Start with your Mac") {
                    RuntimeLoginControl(store: model.menu)
                }
                Section("1. Choose your runtimes") {
                    Text("Use Codex, Pi, or both. Adding Pi keeps your existing default Persona.")
                    HStack {
                        Text("Codex").font(.headline)
                        Spacer()
                        if let url = URL(string: "https://developers.openai.com/codex/quickstart") {
                            Link("OpenAI Codex", destination: url)
                        }
                    }
                    Text("Use your installed, signed-in Codex. NanthAI does not install or change Codex for you.")
                        .foregroundStyle(.secondary)
                    if !model.codexPath.isEmpty {
                        Text(model.codexPath).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    }
                    HStack {
                        if let url = detectedCodex.first {
                            Button("Use default location") { Task { await model.selectCodex(url) } }
                        }
                        Button("Choose executable…", action: chooseCodex)
                    }
                    if let version = model.cliVersion { LabeledContent("Codex version", value: version) }
                    RuntimeReadinessLabel(name: "Codex", ready: model.codexReady, selected: !model.codexPath.isEmpty)
                    if let error = model.codexReadinessError { Text(error).font(.caption).foregroundStyle(.orange) }
                    if let identity = model.identity { LabeledContent("Codex account", value: identity) }
                }
                RuntimePiSetupContent(model: model)
                Section("2. Pair your NanthAI account") {
                    if model.isPaired {
                        Label("This Mac is paired", systemImage: "checkmark.circle.fill")
                        Button("Disconnect this Mac") { Task { await model.disconnectAccount() } }
                            .disabled(model.busy)
                    } else {
                        Button("Connect NanthAI account") { model.connectAccount() }.disabled(model.busy)
                        if model.connectionPending { Text("Finish connecting this Mac in your browser, then return here.") }
                        Text("Using your phone? In NanthAI Settings → Local runtime, create a pairing code and enter it here.")
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Pairing code")
                            TextField("Paste your pairing code", text: $model.pairingCode)
                                .labelsHidden()
                                .textFieldStyle(.roundedBorder)
                                .font(.body.monospaced())
                                .frame(maxWidth: .infinity)
                                .accessibilityLabel("Pairing code")
                        }
                        Button("Connect with code") { Task { await model.pair() } }
                            .disabled(model.busy || model.pairingCode.isEmpty)
                        DisclosureGroup("Advanced command pairing") {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Pairing command")
                                TextField("Paste your pairing command", text: $model.pairingCommand, axis: .vertical)
                                    .labelsHidden()
                                    .textFieldStyle(.roundedBorder)
                                    .font(.body.monospaced()).lineLimit(2...4)
                                    .frame(maxWidth: .infinity)
                                    .accessibilityLabel("Pairing command")
                            }
                            Button("Pair this Mac") { Task { model.pairingCode = ""; await model.pair() } }
                                .disabled(model.busy || model.pairingCommand.isEmpty)
                        }
                    }
                }
                Section("3. Start a conversation") {
                    Text("The Runtime Host starts automatically after setup and when you open this app. Keep this Mac awake and online. Start a chat with its Codex or Pi Persona in NanthAI. Runtime changes apply after current work finishes.")
                    HStack {
                        Label(model.connectionIndicator.label, systemImage: model.menu.snapshot.systemImage)
                            .foregroundStyle(model.connectionIndicator.tone == .ready ? Color.green : model.connectionIndicator.tone == .problem ? Color.red : Color.orange)
                        Spacer()
                        Button(model.menu.snapshot.canStart ? "Start" : "Stop") {
                            Task {
                                if model.menu.snapshot.canStart { await model.menu.startRuntime() }
                                else { await model.menu.stopRuntime() }
                            }
                        }.disabled(model.menu.isPerformingAction)
                    }
                }
                if let error = model.error {
                    Section { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                }
                Section("Update or roll back") {
                    Text("Stop the Runtime Host, quit NanthAI Runtime, then replace the app in Applications with the version you chose. Reopen it to resume. Pairing and published results are retained.")
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, minHeight: 440)
            HStack {
                Button("Refresh readiness") { Task { await model.refreshReadiness() } }
                Spacer()
                Button("Settings & usage…") { showSettings = true }
            }.padding()
        }
        .sheet(isPresented: $showSettings) { RuntimeSettingsContent(store: model.menu) }
    }

    @State private var showSettings = false
    private var detectedCodex: [URL] {
        ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/Applications/Codex.app/Contents/Resources/codex",
         "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"]
            .filter { FileManager.default.isExecutableFile(atPath: $0) }.map { URL(filePath: $0) }
    }

    private func chooseCodex() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = "Choose the installed Codex executable. You can navigate inside an app package."
        panel.treatsFilePackagesAsDirectories = true
        if panel.runModal() == .OK, let url = panel.url { Task { await model.selectCodex(url) } }
    }
}
