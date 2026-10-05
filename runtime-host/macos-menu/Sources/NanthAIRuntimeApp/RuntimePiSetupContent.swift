import AppKit
import SwiftUI
import NanthAIRuntimeMenu

struct RuntimePiSetupContent: View {
    @Bindable var model: RuntimeAppModel

    var body: some View {
        Section {
            HStack {
                Text("Pi").font(.headline)
                Spacer()
                if let url = URL(string: "https://github.com/earendil-works/pi/tree/main/packages/coding-agent") {
                    Link("Pi setup", destination: url)
                }
            }
            Text("Use your installed Pi with any provider configured in Pi, including subscription accounts, API providers and local models.")
                .foregroundStyle(.secondary)
            if !model.piPath.isEmpty {
                Text(model.piPath).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
            }
            HStack {
                if let url = detectedPi.first {
                    Button("Use default location") { Task { await model.selectPi(url) } }
                }
                Button("Choose executable…") { choose(directory: false) }
            }
            Button("Choose Pi working folder…") { choose(directory: true) }
            if !model.piWorkingDirectory.isEmpty {
                Text(model.piWorkingDirectory).font(.caption.monospaced()).textSelection(.enabled)
            }
            if let version = model.piVersion { LabeledContent("Pi version", value: version) }
            RuntimeReadinessLabel(name: "Pi", ready: model.piReady, selected: !model.piPath.isEmpty)
            LabeledContent("Available models", value: model.piModelCount.map(String.init) ?? "Not checked")
            if let error = model.piReadinessError { Text(error).font(.caption).foregroundStyle(.orange) }
            else if !model.piPath.isEmpty && !model.piReady {
                Text("Select an available model and sign in or configure its provider in Pi, then refresh readiness.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("Pi uses its own tools and extensions with their normal permissions. RPC mode supports standard dialogs; custom terminal interfaces are unavailable.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var detectedPi: [URL] {
        [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".npm-global/bin/pi").path,
         "/opt/homebrew/bin/pi", "/usr/local/bin/pi"]
            .filter { FileManager.default.isExecutableFile(atPath: $0) }.map { URL(filePath: $0) }
    }

    private func choose(directory: Bool) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = !directory
        panel.canChooseDirectories = directory
        panel.allowsMultipleSelection = false
        panel.treatsFilePackagesAsDirectories = true
        panel.message = directory ? "Choose the working folder for Pi’s project configuration and tools." : "Choose your installed Pi executable."
        if panel.runModal() == .OK, let url = panel.url {
            Task { if directory { await model.selectPiDirectory(url) } else { await model.selectPi(url) } }
        }
    }
}
